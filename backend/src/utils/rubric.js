// Shared rubric validation/sanitization, used by the instructor admin routes
// and the super-admin portal routes so both save paths enforce the same rules.

const MAX_EXEMPLARS_PER_CRITERION = 5;
const MAX_EXEMPLAR_EXCERPT_CHARS = 5000;
const MAX_EXEMPLAR_EXPLANATION_CHARS = 2000;
const MAX_RUBRIC_CRITERIA = 25;
const MAX_LEVELS_PER_CRITERION = 10;

// Returns an error string, or null when the rubric is within the limits that
// keep the evaluation prompt inside the model's context budget.
function validateRubricShape(rubric) {
  if (rubric === undefined || rubric === null) return null;
  if (!Array.isArray(rubric)) return 'Rubric must be an array of criteria';
  if (rubric.length > MAX_RUBRIC_CRITERIA) {
    return `Rubric cannot have more than ${MAX_RUBRIC_CRITERIA} criteria`;
  }
  for (const criterion of rubric) {
    if (criterion && Array.isArray(criterion.levels) && criterion.levels.length > MAX_LEVELS_PER_CRITERION) {
      return `Criterion "${criterion.name || criterion.id || '?'}" cannot have more than ${MAX_LEVELS_PER_CRITERION} levels`;
    }
  }
  return null;
}

// Exemplar scores feed the grading prompt as calibration anchors; an
// out-of-range score (e.g. 150 on a 25-point criterion) would miscalibrate
// the grader, so clamp to the criterion's bounds.
function sanitizeExemplarScore(rawScore, criterion, scoringEnabled) {
  if (!scoringEnabled || rawScore == null) return null;
  const score = Number(rawScore);
  if (!Number.isFinite(score)) return null;
  const max = Number(criterion.max_points);
  const upper = Number.isFinite(max) && max >= 0 ? max : Infinity;
  return Math.min(Math.max(score, 0), upper);
}

// Sanitize rubric exemplars in-place. Caps per-criterion count, trims long
// fields, drops malformed entries, strips scores in scoreless mode. Returns
// the sanitized rubric (new array).
function sanitizeRubricExemplars(rubric, scoringEnabled) {
  if (!Array.isArray(rubric)) return rubric;
  return rubric.map((criterion) => {
    if (!criterion || typeof criterion !== 'object') return criterion;
    const raw = Array.isArray(criterion.exemplars) ? criterion.exemplars : [];
    const cleaned = raw
      .filter((ex) => ex && typeof ex === 'object' && typeof ex.excerpt === 'string' && ex.excerpt.trim().length > 0)
      .slice(0, MAX_EXEMPLARS_PER_CRITERION)
      .map((ex) => ({
        id: typeof ex.id === 'string' && ex.id ? ex.id : `exemplar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        label: typeof ex.label === 'string' ? ex.label.slice(0, 100) : '',
        score: sanitizeExemplarScore(ex.score, criterion, scoringEnabled),
        excerpt: ex.excerpt.slice(0, MAX_EXEMPLAR_EXCERPT_CHARS),
        explanation: typeof ex.explanation === 'string' ? ex.explanation.slice(0, MAX_EXEMPLAR_EXPLANATION_CHARS) : '',
        source_session_id: Number.isInteger(ex.source_session_id) ? ex.source_session_id : null,
        created_at: typeof ex.created_at === 'string' ? ex.created_at : new Date().toISOString(),
      }));
    return { ...criterion, exemplars: cleaned };
  });
}

module.exports = {
  MAX_EXEMPLARS_PER_CRITERION,
  MAX_EXEMPLAR_EXCERPT_CHARS,
  MAX_EXEMPLAR_EXPLANATION_CHARS,
  MAX_RUBRIC_CRITERIA,
  MAX_LEVELS_PER_CRITERION,
  validateRubricShape,
  sanitizeExemplarScore,
  sanitizeRubricExemplars,
};
