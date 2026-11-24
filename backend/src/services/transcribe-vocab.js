const crypto = require('crypto');
const {
  TranscribeClient,
  CreateVocabularyCommand,
  UpdateVocabularyCommand,
  GetVocabularyCommand,
  DeleteVocabularyCommand,
} = require('@aws-sdk/client-transcribe');
const pool = require('../config/database');

// Per-assignment Transcribe custom vocabularies (see docs/Runbooks.md →
// "Voice input"). Biases streaming transcription toward the proper nouns a
// student will actually say — persona names, stage titles, rubric criteria —
// which is the whole reason for moving off the Web Speech API ("Margaret").
//
// State lives in assignments.transcribe_vocab (JSONB, server-managed only):
//   { vocabulary_name, state: 'PENDING'|'READY'|'FAILED', terms_hash, last_error }
//
// Vocabularies build asynchronously on AWS (minutes). Until READY, streams
// simply run without biasing. syncVocabulary() is fire-and-forget from the
// assignment save paths and never throws into them.

const voice = require('./voice');

let client = null;
let unavailable = false; // AccessDenied → skip syncs for the process lifetime

const READY_CACHE_MS = 5 * 60 * 1000;
const MAX_TERMS = 200;
const readyCache = new Map(); // assignment_id → { at, state, name }

function getClient() {
  if (!client) {
    client = new TranscribeClient(voice.awsClientOptions());
  }
  return client;
}

// Multi-word capitalized sequences only ("Margaret Chen", "General Hospital") —
// conservative on purpose; single capitalized words are mostly sentence starts.
function properNouns(text) {
  if (typeof text !== 'string') return [];
  return text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
}

// Transcribe phrases: no spaces (hyphenate), only letters/apostrophes/hyphens/periods.
function toPhrase(term) {
  const phrase = String(term).trim().replace(/\s+/g, '-');
  return /^[a-zA-Z'.-]+$/.test(phrase) && phrase.length > 2 ? phrase : null;
}

function buildVocabularyTerms(assignment) {
  const raw = [];
  raw.push(assignment.persona_name);

  for (const stage of Array.isArray(assignment.stages) ? assignment.stages : []) {
    raw.push(stage?.persona_name, stage?.title);
  }
  for (const criterion of Array.isArray(assignment.rubric) ? assignment.rubric : []) {
    raw.push(criterion?.name);
  }
  const areas = assignment.examiner_config?.question_areas;
  for (const area of Array.isArray(areas) ? areas : []) {
    raw.push(area?.topic);
  }
  raw.push(...properNouns(assignment.persona_description));
  raw.push(...properNouns(assignment.scenario_context));

  const phrases = new Set();
  for (const term of raw) {
    if (!term) continue;
    const phrase = toPhrase(term);
    if (phrase) phrases.add(phrase);
    if (phrases.size >= MAX_TERMS) break;
  }
  return [...phrases].sort();
}

function termsHash(terms) {
  return crypto.createHash('sha256').update(terms.join('\n')).digest('hex').slice(0, 16);
}

async function saveState(assignmentId, state) {
  await pool.query('UPDATE assignments SET transcribe_vocab = $1 WHERE id = $2', [
    JSON.stringify(state),
    assignmentId,
  ]);
  readyCache.delete(assignmentId);
}

/**
 * Create/update the assignment's vocabulary when its terms changed.
 * Fire-and-forget from save paths: never throws.
 */
async function syncVocabulary(assignmentId) {
  if (unavailable || voice.status().input !== 'aws') return;
  try {
    const { rows } = await pool.query(
      `SELECT id, persona_name, persona_description, scenario_context, stages,
              rubric, examiner_config, voice_config, transcribe_vocab
         FROM assignments WHERE id = $1`,
      [assignmentId]
    );
    const assignment = rows[0];
    if (!assignment) return;
    if (assignment.voice_config?.enabled !== true) return;

    const terms = buildVocabularyTerms(assignment);
    if (terms.length === 0) return;

    const hash = termsHash(terms);
    const existing = assignment.transcribe_vocab;
    if (existing?.terms_hash === hash && existing?.state !== 'FAILED') return;

    const name = `ltisim-a${assignmentId}`;
    const params = { VocabularyName: name, LanguageCode: 'en-US', Phrases: terms };
    try {
      if (existing?.vocabulary_name) {
        await getClient().send(new UpdateVocabularyCommand(params));
      } else {
        await getClient().send(new CreateVocabularyCommand(params));
      }
    } catch (err) {
      // Create-after-manual-delete drift or vice versa: try the other verb once.
      if (err.name === 'ConflictException') {
        await getClient().send(new UpdateVocabularyCommand(params));
      } else if (err.name === 'NotFoundException' || err.name === 'BadRequestException') {
        await getClient().send(new CreateVocabularyCommand(params));
      } else {
        throw err;
      }
    }

    await saveState(assignmentId, {
      vocabulary_name: name,
      state: 'PENDING',
      terms_hash: hash,
      last_error: null,
    });
    console.log(`[transcribe-vocab] syncing ${name} (${terms.length} terms)`);
  } catch (err) {
    if (err.name === 'AccessDeniedException') {
      unavailable = true;
      console.warn('[transcribe-vocab] access denied — vocabulary sync disabled until the IAM policy is added (see docs/Voice.md) and the service restarts');
      return;
    }
    console.error(`[transcribe-vocab] sync failed for assignment ${assignmentId}:`, err.message);
    try {
      await saveState(assignmentId, {
        vocabulary_name: `ltisim-a${assignmentId}`,
        state: 'FAILED',
        terms_hash: null,
        last_error: err.message,
      });
    } catch {}
  }
}

/**
 * Name of the assignment's vocabulary if it is READY on AWS, else null
 * (stream without biasing). PENDING states are re-probed at most every 5 min.
 * vocab = the assignment's transcribe_vocab JSONB value.
 */
async function getReadyVocabularyName(assignmentId, vocab) {
  if (unavailable || voice.status().input !== 'aws' || !vocab?.vocabulary_name) return null;
  if (vocab.state === 'READY') return vocab.vocabulary_name;
  if (vocab.state !== 'PENDING') return null;

  const cached = readyCache.get(assignmentId);
  if (cached && Date.now() - cached.at < READY_CACHE_MS) {
    return cached.state === 'READY' ? cached.name : null;
  }
  try {
    const res = await getClient().send(
      new GetVocabularyCommand({ VocabularyName: vocab.vocabulary_name })
    );
    const state = res.VocabularyState; // PENDING | READY | FAILED
    readyCache.set(assignmentId, { at: Date.now(), state, name: vocab.vocabulary_name });
    if (state !== 'PENDING') {
      await saveState(assignmentId, {
        ...vocab,
        state,
        last_error: state === 'FAILED' ? res.FailureReason || 'build failed' : null,
      });
      readyCache.set(assignmentId, { at: Date.now(), state, name: vocab.vocabulary_name });
    }
    return state === 'READY' ? vocab.vocabulary_name : null;
  } catch (err) {
    if (err.name === 'AccessDeniedException') unavailable = true;
    readyCache.set(assignmentId, { at: Date.now(), state: 'UNKNOWN', name: null });
    return null;
  }
}

/** Best-effort cleanup when an assignment is deleted. Never throws. */
async function deleteVocabulary(assignmentId, vocab) {
  readyCache.delete(assignmentId);
  const name = vocab?.vocabulary_name || `ltisim-a${assignmentId}`;
  if (unavailable || voice.status().input !== 'aws') return;
  try {
    await getClient().send(new DeleteVocabularyCommand({ VocabularyName: name }));
    console.log(`[transcribe-vocab] deleted ${name}`);
  } catch (err) {
    if (err.name === 'AccessDeniedException') unavailable = true;
    else if (err.name !== 'NotFoundException' && err.name !== 'BadRequestException') {
      console.error(`[transcribe-vocab] delete failed for ${name}:`, err.message);
    }
  }
}

module.exports = {
  buildVocabularyTerms,
  syncVocabulary,
  getReadyVocabularyName,
  deleteVocabulary,
};
