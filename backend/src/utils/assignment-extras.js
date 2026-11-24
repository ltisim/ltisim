// Sanitizers for the type-specific assignment configs added in v16.
// Applied on every save path (instructor save, import, template, duplicate).

const MAX_STAGES = 8;

// staged_simulation: ordered scenes. Each stage: title, scene_context (from
// the persona's perspective), optional persona_name override, and the number
// of student messages required before the student may advance.
function sanitizeStages(raw) {
  if (!Array.isArray(raw)) return null;
  const stages = raw.slice(0, MAX_STAGES).map((s, i) => ({
    id: typeof s?.id === 'string' && s.id ? s.id.slice(0, 40) : `stage${i + 1}`,
    title: String(s?.title || `Stage ${i + 1}`).slice(0, 200),
    scene_context: String(s?.scene_context || '').slice(0, 8000),
    persona_name: s?.persona_name ? String(s.persona_name).slice(0, 200) : null,
    min_messages: Number.isInteger(Number(s?.min_messages)) && Number(s.min_messages) > 0
      ? Math.min(Number(s.min_messages), 25)
      : 1,
  }));
  return stages.length > 0 ? stages : null;
}

// simulation_with_artifact: the write-up phase config.
function sanitizeArtifactConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v, lo, hi) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
  };
  return {
    title: String(raw.title || 'Written Summary').slice(0, 200),
    instructions: String(raw.instructions || '').slice(0, 8000),
    template_text: String(raw.template_text || '').slice(0, 8000),
    min_words: num(raw.min_words, 1, 5000),
    max_words: num(raw.max_words, 10, 10000),
  };
}

// The marker line inserted into the transcript at each stage boundary. Both
// the chat model and the grader key off this exact prefix.
function stageDividerText(index, stage) {
  return `[The scene shifts — Stage ${index + 1}: ${stage.title}]`;
}

const MAX_QUESTION_AREAS = 10;

// ai_examiner: the AI leads the student through these areas in order.
// style 'exam' = oral-exam probing; 'debrief' = reflective coaching.
function sanitizeExaminerConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const style = raw.style === 'debrief' ? 'debrief' : 'exam';
  const areas = Array.isArray(raw.question_areas) ? raw.question_areas : [];
  const question_areas = areas.slice(0, MAX_QUESTION_AREAS).map((a, i) => ({
    id: typeof a?.id === 'string' && a.id ? a.id.slice(0, 40) : `area${i + 1}`,
    topic: String(a?.topic || `Topic ${i + 1}`).slice(0, 300),
    guidance: String(a?.guidance || '').slice(0, 3000),
    required: a?.required !== false,
    followup_depth: [0, 1, 2].includes(Number(a?.followup_depth)) ? Number(a.followup_depth) : 1,
  }));
  if (question_areas.length === 0) return null;
  return { style, question_areas };
}

// The marker the examiner AI appends when it finishes an area. The chat route
// strips it from the student-visible reply and records coverage server-side.
const AREA_MARKER_RE = /\[\[area_done:([a-zA-Z0-9_-]{1,40})\]\]/g;

// Voice: input is always browser-side; voice_id selects the Polly voice for
// spoken replies (when TTS is available server-side).
const POLLY_VOICES = ['Joanna', 'Matthew', 'Ruth', 'Stephen', 'Danielle', 'Gregory', 'Ivy', 'Kimberly'];
function sanitizeVoiceConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.enabled !== true) return null;
  return {
    enabled: true,
    voice_id: POLLY_VOICES.includes(raw.voice_id) ? raw.voice_id : 'Joanna',
  };
}

module.exports = {
  sanitizeStages, sanitizeArtifactConfig, stageDividerText, MAX_STAGES,
  sanitizeExaminerConfig, AREA_MARKER_RE, MAX_QUESTION_AREAS,
  sanitizeVoiceConfig, POLLY_VOICES,
};
