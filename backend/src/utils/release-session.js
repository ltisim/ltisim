const pool = require('../config/database');
const { submitGradeForSession } = require('./grade-passback');

/**
 * Release a pending-review session to the learner: apply optional instructor
 * overrides, mark released, commit, THEN attempt grade passback post-commit
 * (failures are queued for retry by grade-passback.js — they no longer block
 * or roll back the release itself).
 *
 * Shared by the instructor admin route and the super-admin portal route.
 *
 * @param {number} sessionId
 * @param {object} opts
 *   platformId        scope check for instructor calls; null skips (portal)
 *   releasedBy        users.id of the releasing instructor, or null (portal)
 *   score, score_breakdown, overall_feedback   optional overrides
 * @returns { ok, score, gradeSubmission } or throws with statusCode 404/400
 */
async function releaseSessionById(sessionId, {
  platformId = null,
  releasedBy = null,
  score,
  score_breakdown,
  overall_feedback,
} = {}) {
  const client = await pool.connect();
  let session;
  let finalScore;

  try {
    await client.query('BEGIN');

    const params = [sessionId];
    let scope = '';
    if (platformId != null) {
      scope = ' AND a.platform_id = $2';
      params.push(platformId);
    }
    const sessionResult = await client.query(
      `SELECT s.*, a.platform_id AS a_platform_id, a.max_score, a.scoring_enabled
       FROM simulation_sessions s
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.id = $1${scope}
       FOR UPDATE OF s`,
      params
    );
    if (sessionResult.rows.length === 0) {
      const err = new Error('Session not found');
      err.statusCode = 404;
      throw err;
    }
    session = sessionResult.rows[0];
    if (session.review_status !== 'pending_review') {
      const err = new Error('Session is not pending review');
      err.statusCode = 400;
      throw err;
    }
    // Sessions whose AI evaluation never completed have no draft to release —
    // releasing one would post a null/zero grade. Regrade first (or wait for
    // the evaluation-retry worker), unless the instructor supplied explicit
    // score overrides, which is the manual-grading escape hatch.
    if (session.evaluation_status && score === undefined && score_breakdown === undefined) {
      const err = new Error(
        'This session has no completed AI evaluation yet (evaluation is retrying or failed). ' +
        'Use Regrade to run the evaluation, or edit the evaluation manually before releasing.'
      );
      err.statusCode = 400;
      throw err;
    }

    finalScore = score !== undefined ? score : session.score;
    const finalScoreBreakdown = score_breakdown || session.score_breakdown;
    let finalAiEvaluation = session.ai_evaluation || {};
    if (overall_feedback !== undefined) {
      finalAiEvaluation = { ...finalAiEvaluation, overall_feedback };
    }

    await client.query(
      `UPDATE simulation_sessions
       SET review_status = 'released',
           released_at = CURRENT_TIMESTAMP,
           released_by = $1,
           score = $2,
           score_breakdown = $3,
           ai_evaluation = $4,
           evaluation_status = NULL,
           evaluation_error = NULL,
           next_evaluation_at = NULL
       WHERE id = $5`,
      [
        releasedBy,
        finalScore,
        JSON.stringify(finalScoreBreakdown),
        JSON.stringify(finalAiEvaluation),
        sessionId,
      ]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const gradeSubmission = await submitGradeForSession({
    sessionId,
    score: finalScore,
    maxScore: session.max_score,
    scoringEnabled: session.scoring_enabled !== false,
    ltiGradeContext: session.lti_grade_context,
  });

  return { ok: true, score: finalScore, gradeSubmission };
}

module.exports = { releaseSessionById };
