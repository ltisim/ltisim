const pool = require('../config/database');
const { evaluateSession } = require('../services/ai/scoring');

// Shared regrade logic for the instructor admin routes and the super-admin
// portal. Only pending-review drafts may ever be regraded — released sessions
// are frozen to preserve the LMS gradebook entry.

/**
 * Regrade a single completed session against the current assignment rubric.
 * Loads the transcript + assignment, runs evaluateSession(), writes the new
 * score and score_breakdown. Does NOT touch the LMS.
 *
 * @param {object} client      pg client with an open transaction
 * @param {number} sessionId
 * @param {number|null} platformId  scope check for instructor calls; null skips
 *                                  scoping (super-admin portal)
 * @param {object} [opts]      { regradedBy } written into ai_evaluation
 * @returns { ok, score, score_breakdown, ai_evaluation } or throws with statusCode
 */
async function regradeSessionById(client, sessionId, platformId, opts = {}) {
  const params = [sessionId];
  let scope = '';
  if (platformId != null) {
    scope = ' AND a.platform_id = $2';
    params.push(platformId);
  }
  const sessionResult = await client.query(
    `SELECT s.*, a.platform_id, a.id AS a_id
     FROM simulation_sessions s
     JOIN assignments a ON s.assignment_id = a.id
     WHERE s.id = $1${scope}`,
    params
  );
  if (sessionResult.rows.length === 0) {
    const err = new Error('Session not found');
    err.statusCode = 404;
    throw err;
  }
  const session = sessionResult.rows[0];
  if (session.status !== 'completed') {
    const err = new Error('Session is not completed');
    err.statusCode = 400;
    throw err;
  }
  if (session.review_status !== 'pending_review') {
    const err = new Error('Only pending-review sessions can be regraded. Released sessions are frozen to preserve the Canvas gradebook entry.');
    err.statusCode = 400;
    throw err;
  }

  const assignmentResult = await client.query(
    'SELECT * FROM assignments WHERE id = $1',
    [session.assignment_id]
  );
  const assignment = assignmentResult.rows[0];

  const interactionsResult = await client.query(
    `SELECT role, content FROM simulation_interactions WHERE session_id = $1 ORDER BY timestamp ASC`,
    [sessionId]
  );
  const messages = interactionsResult.rows;

  assignment._session_id = sessionId;
  const artifactText = session.data?.artifact?.text || null;
  const evaluation = await evaluateSession(assignment, messages, { artifactText });

  const newScoreBreakdown = {
    criteria_evaluations: evaluation.criteria_evaluations || [],
    ...(evaluation.consistency_notes && { consistency_notes: evaluation.consistency_notes }),
  };
  const newAiEvaluation = {
    overall_feedback: evaluation.overall_feedback || '',
    fallback: !!evaluation.fallback,
    scoring_enabled: evaluation.scoring_enabled !== false,
    regraded_at: new Date().toISOString(),
  };
  if (opts.regradedBy) {
    newAiEvaluation.regraded_by = opts.regradedBy;
  }

  // A successful regrade also clears any evaluation-failure state (a
  // failed_permanent session is revived by exactly this path).
  await client.query(
    `UPDATE simulation_sessions
     SET score = $1,
         score_breakdown = $2::jsonb,
         ai_evaluation = $3::jsonb,
         evaluation_status = NULL,
         evaluation_error = NULL,
         next_evaluation_at = NULL
     WHERE id = $4`,
    [
      evaluation.score,
      JSON.stringify(newScoreBreakdown),
      JSON.stringify(newAiEvaluation),
      sessionId,
    ]
  );

  return { ok: true, score: evaluation.score, score_breakdown: newScoreBreakdown, ai_evaluation: newAiEvaluation };
}

/**
 * Regrade every pending-review session under an assignment, one transaction
 * per session so a single failure never aborts the batch.
 */
async function regradePendingForAssignment(assignmentId, platformId, opts = {}) {
  const pending = await pool.query(
    `SELECT s.id FROM simulation_sessions s
     WHERE s.assignment_id = $1 AND s.status = 'completed' AND s.review_status = 'pending_review'
     ORDER BY s.id ASC`,
    [assignmentId]
  );

  const results = { total: pending.rows.length, succeeded: 0, failed: 0, errors: [] };

  for (const row of pending.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await regradeSessionById(client, row.id, platformId, opts);
      await client.query('COMMIT');
      results.succeeded += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      results.failed += 1;
      results.errors.push({ session_id: row.id, message: error.message });
      console.error(`Regrade failed for session ${row.id}:`, error.message);
    } finally {
      client.release();
    }
  }

  return results;
}

module.exports = { regradeSessionById, regradePendingForAssignment };
