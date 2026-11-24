const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { verifyLTI, verifyInstructor, getContextId } = require('../middleware/auth');
const { getProvider } = require('../services/ai/index');
const aiModels = require('../services/ai/models');
const { evaluateSession, extractJSON } = require('../services/ai/scoring');
const { validateRubricShape, sanitizeRubricExemplars } = require('../utils/rubric');
const { sanitizeLearningContent } = require('../utils/sanitize-learning-content');
const { sanitizeStages, sanitizeArtifactConfig, sanitizeExaminerConfig, sanitizeVoiceConfig } = require('../utils/assignment-extras');
const { logAiUsage } = require('../utils/ai-usage');
const { checkAiQuota } = require('../utils/ai-quota');
const { syncVocabulary } = require('../services/transcribe-vocab');

// Authoring assistance (Plan 02) and assignment reuse (Plan 03).
// Mounted under /api/admin alongside routes/admin.js.

const ALLOWED_TYPES = ['simulation', 'llm_interaction', 'staged_simulation', 'simulation_with_artifact', 'ai_examiner'];
const EXPORT_FORMAT = 'ltisim_assignment_v1';

// The authoring fields that travel through duplicate/export/import/templates.
// Deliberately excludes ids, resource links, publication state, and course/
// platform scoping — those always belong to the destination.
const AUTHORING_FIELDS = [
  'title', 'description', 'welcome_message', 'persona_name', 'persona_description',
  'scenario_context', 'system_prompt', 'rubric', 'completion_conditions',
  'ai_provider_config', 'max_score', 'scoring_enabled', 'max_sessions',
  'feedback_release_mode', 'assignment_type', 'learning_content', 'allow_practice',
  'stages', 'artifact_config', 'examiner_config', 'voice_config',
];

function pickAuthoringFields(source) {
  const out = {};
  for (const f of AUTHORING_FIELDS) out[f] = source[f] ?? null;
  return out;
}

// Exemplars carry source_session_id back-references; those sessions belong to
// the source assignment's course and must not travel.
function stripExemplarSessionRefs(rubric) {
  return (rubric || []).map((c) => ({
    ...c,
    exemplars: Array.isArray(c.exemplars)
      ? c.exemplars.map(({ source_session_id, ...ex }) => ex)
      : [],
  }));
}

// Validate + sanitize an untrusted authoring payload (import, template) the
// same way the normal save path does. Returns { fields } or { error }.
function sanitizeAuthoringPayload(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'Invalid assignment payload' };
  if (!raw.title || typeof raw.title !== 'string') return { error: 'Title is required' };
  const type = raw.assignment_type || 'simulation';
  if (!ALLOWED_TYPES.includes(type)) return { error: 'Invalid assignment_type' };
  const mode = raw.feedback_release_mode || 'immediate';
  if (!['immediate', 'instructor_review', 'confidence_gated'].includes(mode)) {
    return { error: 'Invalid feedback_release_mode' };
  }
  const rubric = Array.isArray(raw.rubric) ? raw.rubric : [];
  const rubricError = validateRubricShape(rubric);
  if (rubricError) return { error: `Rubric: ${rubricError}` };
  const scoringEnabled = raw.scoring_enabled !== false;
  return {
    fields: {
      title: String(raw.title).slice(0, 300),
      description: raw.description ? String(raw.description) : null,
      welcome_message: raw.welcome_message ? String(raw.welcome_message) : null,
      persona_name: raw.persona_name ? String(raw.persona_name) : null,
      persona_description: raw.persona_description ? String(raw.persona_description) : null,
      scenario_context: raw.scenario_context ? String(raw.scenario_context) : null,
      system_prompt: raw.system_prompt ? String(raw.system_prompt) : null,
      rubric: sanitizeRubricExemplars(stripExemplarSessionRefs(rubric), scoringEnabled),
      completion_conditions: (raw.completion_conditions && typeof raw.completion_conditions === 'object') ? raw.completion_conditions : {},
      ai_provider_config: (raw.ai_provider_config && typeof raw.ai_provider_config === 'object') ? raw.ai_provider_config : {},
      max_score: Number.isFinite(Number(raw.max_score)) && Number(raw.max_score) > 0 ? Number(raw.max_score) : 100,
      scoring_enabled: scoringEnabled,
      max_sessions: raw.max_sessions == null ? 1 : (Number.isFinite(Number(raw.max_sessions)) ? Number(raw.max_sessions) : 1),
      feedback_release_mode: mode,
      assignment_type: type,
      learning_content: sanitizeLearningContent(raw.learning_content),
      allow_practice: raw.allow_practice === true,
      stages: sanitizeStages(raw.stages),
      artifact_config: sanitizeArtifactConfig(raw.artifact_config),
      examiner_config: sanitizeExaminerConfig(raw.examiner_config),
      voice_config: sanitizeVoiceConfig(raw.voice_config),
    },
  };
}

async function insertAssignment(courseId, contextId, platformId, fields) {
  const result = await pool.query(
    `INSERT INTO assignments (
       course_id, lti_context_id, lti_resource_link_id, platform_id, is_published,
       title, description, welcome_message, persona_name, persona_description,
       scenario_context, system_prompt, rubric, completion_conditions,
       ai_provider_config, max_score, scoring_enabled, max_sessions,
       feedback_release_mode, assignment_type, learning_content, allow_practice,
       stages, artifact_config, examiner_config, voice_config
     ) VALUES ($1,$2,$3,$4,false,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
     RETURNING *`,
    [
      courseId, contextId, `assignment_${Date.now()}_${Math.floor(Math.random() * 1e6)}`, platformId,
      fields.title, fields.description, fields.welcome_message, fields.persona_name,
      fields.persona_description, fields.scenario_context, fields.system_prompt,
      JSON.stringify(fields.rubric || []), JSON.stringify(fields.completion_conditions || {}),
      JSON.stringify(fields.ai_provider_config || {}), fields.max_score,
      fields.scoring_enabled, fields.max_sessions, fields.feedback_release_mode,
      fields.assignment_type,
      fields.learning_content ? JSON.stringify(fields.learning_content) : null,
      fields.allow_practice === true,
      fields.stages ? JSON.stringify(fields.stages) : null,
      fields.artifact_config ? JSON.stringify(fields.artifact_config) : null,
      fields.examiner_config ? JSON.stringify(fields.examiner_config) : null,
      fields.voice_config ? JSON.stringify(fields.voice_config) : null,
    ]
  );
  // Fire-and-forget: build the Transcribe custom vocabulary for voice input.
  syncVocabulary(result.rows[0].id);
  return result.rows[0];
}

async function courseIdForContext(contextId, platformId) {
  const { rows } = await pool.query(
    'SELECT id FROM courses WHERE lti_context_id = $1 AND platform_id = $2',
    [contextId, platformId]
  );
  return rows[0]?.id || null;
}

// The strong-model provider for authoring calls (same default tier as grading).
function authoringProvider() {
  return getProvider({ model: aiModels.defaultGradingModel() });
}

async function enforceQuota(req, res) {
  const quota = await checkAiQuota();
  if (!quota.allowed) {
    res.status(429).json({ error: 'AI usage limit reached', message: 'Your institution has reached its monthly AI usage limit.' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Plan 03 — duplicate / export / import / templates
// ---------------------------------------------------------------------------

// List the instructor's other courses on this platform (copy-to-course targets)
router.get('/my-courses', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.lti_context_id, c.name
       FROM course_enrollments ce
       JOIN courses c ON ce.course_id = c.id
       JOIN users u ON ce.user_id = u.id
       WHERE u.lti_user_id = $1 AND u.platform_id = $2 AND c.platform_id = $2
         AND (ce.role ILIKE '%instructor%' OR ce.role ILIKE '%teacher%'
              OR ce.role ILIKE '%admin%' OR ce.role ILIKE '%teachingassistant%')
       ORDER BY c.name`,
      [req.ltiToken.user, req.platformId]
    );
    res.json({ courses: rows });
  } catch (error) {
    console.error('Error listing courses:', error);
    res.status(500).json({ error: 'Failed to list courses' });
  }
});

// Duplicate an assignment into this course, or (target_context_id) into
// another course where this instructor teaches. Always lands as a draft.
router.post('/assignments/:assignmentId/duplicate', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const contextId = getContextId(req.ltiToken);
    const { target_context_id } = req.body || {};

    const source = await pool.query(
      'SELECT * FROM assignments WHERE id = $1 AND lti_context_id = $2 AND platform_id = $3',
      [req.params.assignmentId, contextId, req.platformId]
    );
    if (source.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    let destContextId = contextId;
    if (target_context_id && target_context_id !== contextId) {
      // Must be a course on this platform where this user has an instructor enrollment
      const check = await pool.query(
        `SELECT c.id FROM courses c
         JOIN course_enrollments ce ON ce.course_id = c.id
         JOIN users u ON ce.user_id = u.id
         WHERE c.lti_context_id = $1 AND c.platform_id = $2
           AND u.lti_user_id = $3 AND u.platform_id = $2
           AND (ce.role ILIKE '%instructor%' OR ce.role ILIKE '%teacher%'
                OR ce.role ILIKE '%admin%' OR ce.role ILIKE '%teachingassistant%')`,
        [target_context_id, req.platformId, req.ltiToken.user]
      );
      if (check.rows.length === 0) {
        return res.status(403).json({ error: 'You are not an instructor in the target course' });
      }
      destContextId = target_context_id;
    }

    const destCourseId = await courseIdForContext(destContextId, req.platformId);
    if (!destCourseId) return res.status(404).json({ error: 'Target course not found' });

    const fields = pickAuthoringFields(source.rows[0]);
    fields.title = `${fields.title} (Copy)`.slice(0, 300);
    fields.rubric = stripExemplarSessionRefs(fields.rubric);

    const assignment = await insertAssignment(destCourseId, destContextId, req.platformId, fields);
    res.json({ assignment, copied_to_other_course: destContextId !== contextId });
  } catch (error) {
    console.error('Error duplicating assignment:', error);
    res.status(500).json({ error: 'Failed to duplicate assignment' });
  }
});

// Export authoring fields as a portable JSON file
router.get('/assignments/:assignmentId/export', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const contextId = getContextId(req.ltiToken);
    const { rows } = await pool.query(
      'SELECT * FROM assignments WHERE id = $1 AND lti_context_id = $2 AND platform_id = $3',
      [req.params.assignmentId, contextId, req.platformId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Assignment not found' });

    const fields = pickAuthoringFields(rows[0]);
    fields.rubric = stripExemplarSessionRefs(fields.rubric);
    const safeTitle = String(fields.title || 'assignment').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.ltisim.json"`);
    res.send(JSON.stringify({ format: EXPORT_FORMAT, exported_at: new Date().toISOString(), assignment: fields }, null, 2));
  } catch (error) {
    console.error('Error exporting assignment:', error);
    res.status(500).json({ error: 'Failed to export assignment' });
  }
});

// Import a previously exported assignment file into this course (as a draft).
// Treated as untrusted input: full validation + sanitization.
router.post('/assignments/import', verifyLTI, verifyInstructor, express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const contextId = getContextId(req.ltiToken);
    const { data } = req.body || {};
    if (!data || data.format !== EXPORT_FORMAT || !data.assignment) {
      return res.status(400).json({ error: 'Not a valid LTISim assignment export file' });
    }
    const { fields, error } = sanitizeAuthoringPayload(data.assignment);
    if (error) return res.status(400).json({ error });

    const courseId = await courseIdForContext(contextId, req.platformId);
    if (!courseId) return res.status(404).json({ error: 'Course not found' });

    const assignment = await insertAssignment(courseId, contextId, req.platformId, fields);
    res.json({ assignment });
  } catch (error) {
    console.error('Error importing assignment:', error);
    res.status(500).json({ error: 'Failed to import assignment' });
  }
});

// Template gallery (read side; curation lives in the portal)
router.get('/assignment-templates', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, discipline, description,
              payload->>'assignment_type' AS assignment_type
       FROM assignment_templates WHERE is_active = true
       ORDER BY discipline NULLS LAST, title`
    );
    res.json({ templates: rows });
  } catch (error) {
    console.error('Error listing templates:', error);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

router.post('/assignments/from-template', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const contextId = getContextId(req.ltiToken);
    const { template_id } = req.body || {};
    const { rows } = await pool.query(
      'SELECT payload FROM assignment_templates WHERE id = $1 AND is_active = true',
      [template_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Template not found' });

    const { fields, error } = sanitizeAuthoringPayload(rows[0].payload);
    if (error) return res.status(400).json({ error: `Template invalid: ${error}` });

    const courseId = await courseIdForContext(contextId, req.platformId);
    if (!courseId) return res.status(404).json({ error: 'Course not found' });

    const assignment = await insertAssignment(courseId, contextId, req.platformId, fields);
    res.json({ assignment });
  } catch (error) {
    console.error('Error creating from template:', error);
    res.status(500).json({ error: 'Failed to create assignment from template' });
  }
});

// ---------------------------------------------------------------------------
// Plan 02 — AI-assisted authoring
// ---------------------------------------------------------------------------

// Generate a complete draft from a plain-language description. Returns the
// draft fields for the editor to prefill — nothing is saved here.
router.post('/assignments/generate-draft', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { description, assignment_type } = req.body || {};
    if (!description || String(description).trim().length < 10) {
      return res.status(400).json({ error: 'Describe the assignment in at least a sentence' });
    }
    const type = ALLOWED_TYPES.includes(assignment_type) ? assignment_type : 'simulation';
    if (!(await enforceQuota(req, res))) return;

    const isLLM = type === 'llm_interaction';
    const systemPrompt = 'You design high-quality AI-powered learning activities: persona-driven role-play simulations and LLM-interaction tasks with rigorous, observable rubrics. You must respond with raw JSON only — no markdown fences, no prose outside the JSON object.';

    const userPrompt = `Create a complete ${isLLM ? 'LLM-interaction activity' : 'role-play simulation assignment'} from this instructor description:

"""${String(description).slice(0, 4000)}"""

Field requirements:
- "title": short, student-facing.
- "description": 2-3 sentences for the student dashboard — what they'll do and what's expected of them.
- "welcome_message": ${isLLM ? 'a friendly kickoff message from the AI assistant orienting the student to the tasks' : "the persona's in-character opening line"}.
${isLLM ? `- "persona_name", "persona_description", "scenario_context": empty strings (not used for this type).
- "system_prompt": instructions for the AI assistant (how to help, what not to reveal, tone).
- "learning_content": { "title": "<side-panel heading>", "html": "<concise lesson panel using only <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em> — the reference material students need for the tasks>" }.` : `- "persona_name": the character's name.
- "persona_description": rich characterization — age, role, personality, emotional state, communication style, what they volunteer vs. withhold unless asked.
- "scenario_context": the situation written FROM THE PERSONA'S PERSPECTIVE (their backstory, motivations, what just happened) so the AI can stay in character.
- "system_prompt": behavioral rules (never break character, keep replies conversational at 2-4 sentences, how to react to student missteps).
- "learning_content": null.`}
- "rubric": 3-5 ${isLLM ? 'tasks' : 'criteria'}. Each: { "id": "c1".."cN", "name", "description" (what it measures, in observable terms${isLLM ? '; each task must be clearly identifiable from a student prompt attempting it' : ''}), "max_points", "levels": exactly 4 of { "label", "score", "description" written as observable behaviors, not vague praise }. The top level's score equals max_points, the lowest is 0, and all max_points must sum to exactly 100.

JSON shape:
{ "title": "...", "description": "...", "welcome_message": "...", "persona_name": "...", "persona_description": "...", "scenario_context": "...", "system_prompt": "...", "learning_content": null, "rubric": [ ... ] }`;

    const provider = authoringProvider();
    const result = await provider.chat({
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      options: { temperature: 0.7, max_tokens: 4096 },
    });

    logAiUsage({
      platform_id: req.platformId,
      model_id: result.metadata?.model,
      call_type: 'authoring',
      usage: result.usage,
    });

    const parsed = extractJSON(result.content);

    // Coerce to the exact contract the editor/save path enforces
    const rubric = (Array.isArray(parsed.rubric) ? parsed.rubric : []).map((c, i) => ({
      id: typeof c.id === 'string' && c.id ? c.id : `c${i + 1}`,
      name: String(c.name || `Criterion ${i + 1}`).slice(0, 200),
      description: String(c.description || ''),
      max_points: Number(c.max_points) || 0,
      levels: (Array.isArray(c.levels) ? c.levels : []).map((lv) => ({
        label: String(lv.label || ''),
        score: Number(lv.score) || 0,
        description: String(lv.description || ''),
      })),
      exemplars: [],
    }));
    const rubricError = validateRubricShape(rubric);
    if (rubricError) {
      console.warn('[authoring] generated rubric failed validation:', rubricError);
      return res.status(502).json({ error: 'Generation produced an invalid rubric — please try again.' });
    }

    res.json({
      draft: {
        title: String(parsed.title || '').slice(0, 300),
        description: String(parsed.description || ''),
        welcome_message: String(parsed.welcome_message || ''),
        persona_name: isLLM ? '' : String(parsed.persona_name || ''),
        persona_description: isLLM ? '' : String(parsed.persona_description || ''),
        scenario_context: isLLM ? '' : String(parsed.scenario_context || ''),
        system_prompt: String(parsed.system_prompt || ''),
        learning_content: isLLM ? sanitizeLearningContent(parsed.learning_content) : null,
        rubric,
        assignment_type: type,
      },
    });
  } catch (error) {
    console.error('Error generating draft:', error);
    res.status(502).json({ error: 'Draft generation failed — please try again.' });
  }
});

const REFINABLE_FIELDS = {
  description: 'the short student-facing description',
  welcome_message: "the AI's opening message",
  persona_name: 'the persona name',
  persona_description: 'the persona background/characterization',
  scenario_context: "the scenario context (written from the persona's perspective)",
  system_prompt: 'the behavioral instructions for the AI',
};

// Regenerate one field given the rest of the (possibly unsaved) assignment as
// context. Stateless — works on drafts that have never been saved.
router.post('/assignments/refine-field', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { assignment, field, instruction } = req.body || {};
    if (!REFINABLE_FIELDS[field]) {
      return res.status(400).json({ error: `field must be one of: ${Object.keys(REFINABLE_FIELDS).join(', ')}` });
    }
    if (!assignment || typeof assignment !== 'object') {
      return res.status(400).json({ error: 'assignment context is required' });
    }
    if (!(await enforceQuota(req, res))) return;

    const ctx = (v) => (v ? String(v).slice(0, 3000) : '(empty)');
    const contextBlock = `ASSIGNMENT CONTEXT:
Type: ${assignment.assignment_type === 'llm_interaction' ? 'LLM interaction activity' : 'Role-play simulation'}
Title: ${ctx(assignment.title)}
Description: ${ctx(assignment.description)}
Persona: ${ctx(assignment.persona_name)} — ${ctx(assignment.persona_description)}
Scenario: ${ctx(assignment.scenario_context)}
AI instructions: ${ctx(assignment.system_prompt)}
Rubric criteria: ${(assignment.rubric || []).map((c) => c?.name).filter(Boolean).join(', ') || '(none)'}`;

    const provider = authoringProvider();
    const result = await provider.chat({
      systemPrompt: 'You are an expert writing coach for AI-powered learning activities. Rewrite the requested field. Respond with ONLY the new text for that field — no preamble, no quotes, no markdown fences.',
      messages: [{
        role: 'user',
        content: `${contextBlock}

FIELD TO REWRITE: "${field}" (${REFINABLE_FIELDS[field]})
CURRENT VALUE:
"""${ctx(assignment[field])}"""
${instruction ? `INSTRUCTOR'S INSTRUCTION: ${String(instruction).slice(0, 500)}` : 'Improve it: more specific, more vivid, better suited to the assignment context.'}`,
      }],
      options: { temperature: 0.7, max_tokens: 1500 },
    });

    logAiUsage({
      platform_id: req.platformId,
      model_id: result.metadata?.model,
      call_type: 'authoring',
      usage: result.usage,
    });

    res.json({ value: result.content.trim() });
  } catch (error) {
    console.error('Error refining field:', error);
    res.status(502).json({ error: 'Refine failed — please try again.' });
  }
});

// AI critique of the rubric (the deterministic points-sum check lives client-side)
router.post('/assignments/critique-rubric', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { rubric, max_score, assignment_type, title, description } = req.body || {};
    if (!Array.isArray(rubric) || rubric.length === 0) {
      return res.status(400).json({ error: 'Add at least one criterion first' });
    }
    if (!(await enforceQuota(req, res))) return;

    const isLLM = assignment_type === 'llm_interaction';
    const rubricText = rubric.map((c, i) =>
      `${i + 1}. ${c.name} (${c.max_points} pts): ${c.description}\n${(c.levels || []).map((lv) => `   - ${lv.label} (${lv.score}): ${lv.description}`).join('\n')}`
    ).join('\n');

    const provider = authoringProvider();
    const result = await provider.chat({
      systemPrompt: 'You audit assessment rubrics for AI-graded learning activities. Respond with raw JSON only.',
      messages: [{
        role: 'user',
        content: `Assignment: ${title || '(untitled)'} — ${description || ''}
Type: ${isLLM ? 'LLM interaction (criteria are tasks graded per student prompt)' : 'role-play simulation (graded on the whole conversation)'}
Max score: ${max_score || 100}

RUBRIC:
${rubricText.slice(0, 8000)}

Audit this rubric against these checks:
1. Are level descriptions observable behaviors (countable, quotable) rather than vague praise ("did well")?
2. Are adjacent levels clearly distinguishable, so two graders would pick the same one?
3. Do criteria overlap (double-grading the same behavior)?
4. ${isLLM ? 'Is each task identifiable from a student prompt attempting it?' : 'Can each criterion actually be evidenced in a chat conversation?'}
5. Is anything important in the assignment description not covered by any criterion?

Return at most 6 findings, most important first. If the rubric is genuinely solid, return fewer or none.

JSON shape: { "suggestions": [ { "criterion": "<criterion name or null for rubric-wide>", "issue": "<one sentence>", "suggestion": "<one concrete sentence>" } ] }`,
      }],
      options: { temperature: 0.3, max_tokens: 1500 },
    });

    logAiUsage({
      platform_id: req.platformId,
      model_id: result.metadata?.model,
      call_type: 'authoring',
      usage: result.usage,
    });

    const parsed = extractJSON(result.content);
    const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : []).slice(0, 6).map((s) => ({
      criterion: s?.criterion ? String(s.criterion).slice(0, 200) : null,
      issue: String(s?.issue || '').slice(0, 500),
      suggestion: String(s?.suggestion || '').slice(0, 500),
    }));
    res.json({ suggestions });
  } catch (error) {
    console.error('Error critiquing rubric:', error);
    res.status(502).json({ error: 'Critique failed — please try again.' });
  }
});

// Grading dry-run: grade a pasted transcript against the SAVED assignment's
// rubric using the real evaluator. No session is created; nothing is stored.
router.post('/assignments/:assignmentId/test-grade', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const contextId = getContextId(req.ltiToken);
    const { transcript } = req.body || {};
    if (!transcript || typeof transcript !== 'string') {
      return res.status(400).json({ error: 'Paste a transcript first' });
    }

    const { rows } = await pool.query(
      'SELECT * FROM assignments WHERE id = $1 AND lti_context_id = $2 AND platform_id = $3',
      [req.params.assignmentId, contextId, req.platformId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Assignment not found' });
    const assignment = rows[0];
    if (!Array.isArray(assignment.rubric) || assignment.rubric.length === 0) {
      return res.status(400).json({ error: 'This assignment has no rubric to grade against' });
    }
    if (!(await enforceQuota(req, res))) return;

    // Parse "Student:" / "AI:" prefixed lines; unprefixed lines continue the
    // previous message.
    const messages = [];
    for (const line of transcript.split('\n')) {
      const m = line.match(/^\s*(student|ai|assistant)\s*:\s*(.*)$/i);
      if (m) {
        messages.push({ role: m[1].toLowerCase() === 'student' ? 'user' : 'assistant', content: m[2] });
      } else if (messages.length > 0 && line.trim()) {
        messages[messages.length - 1].content += `\n${line.trim()}`;
      }
    }
    if (!messages.some((msg) => msg.role === 'user')) {
      return res.status(400).json({ error: 'No student messages found. Prefix lines with "Student:" and "AI:".' });
    }
    if (messages.length > 200) {
      return res.status(400).json({ error: 'Transcript too long' });
    }

    assignment._session_id = null;
    const evaluation = await evaluateSession(assignment, messages);
    res.json({
      evaluation: {
        score: evaluation.score,
        criteria_evaluations: evaluation.criteria_evaluations,
        overall_feedback: evaluation.overall_feedback,
        scoring_enabled: evaluation.scoring_enabled,
      },
      parsed_messages: messages.length,
    });
  } catch (error) {
    console.error('Error test-grading:', error);
    res.status(502).json({ error: 'Test grading failed — please try again.' });
  }
});

module.exports = router;
