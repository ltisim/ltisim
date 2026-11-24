const pool = require('../config/database');
const { evaluateSession, resolveReviewStatus } = require('../services/ai/scoring');
const { submitGradeForSession } = require('./grade-passback');

// Retry worker for failed AI evaluations (fail-safe grading — Plan 08 A).
//
// When the evaluator fails at completion time, the session is completed with
// evaluation_status='pending_evaluation' and review_status='pending_review'
// (so it is visible in the instructor's queue and hidden from the student),
// and no grade is sent to the LMS. This worker re-runs the evaluation with
// backoff. Lifecycle mirrors grade-passback.js:
//   pending_evaluation — due for retry when next_evaluation_at <= NOW()
//   evaluating         — claimed by the worker (transient; next_evaluation_at
//                        doubles as the claim timestamp for stuck recovery)
//   failed_permanent   — retries exhausted; stays pending_review so the
//                        instructor's existing Regrade button can revive it
const BACKOFF_MINUTES = [1, 5, 15, 60, 360];
const MAX_ATTEMPTS = 1 + BACKOFF_MINUTES.length; // initial attempt + retries
const CLAIM_BATCH = 2; // evaluations are slow, expensive AI calls — keep small

async function processSession(sessionRow) {
  const sessionId = sessionRow.id;
  try {
    const assignmentResult = await pool.query(
      'SELECT * FROM assignments WHERE id = $1',
      [sessionRow.assignment_id]
    );
    if (assignmentResult.rows.length === 0) {
      throw new Error(`Assignment ${sessionRow.assignment_id} no longer exists`);
    }
    const assignment = assignmentResult.rows[0];

    const interactionsResult = await pool.query(
      `SELECT role, content FROM simulation_interactions
       WHERE session_id = $1 ORDER BY timestamp ASC`,
      [sessionId]
    );

    assignment._session_id = sessionId;
    const sessionData = await pool.query('SELECT data FROM simulation_sessions WHERE id = $1', [sessionId]);
    const artifactText = sessionData.rows[0]?.data?.artifact?.text || null;
    const evaluation = await evaluateSession(assignment, interactionsResult.rows, { artifactText });

    const scoringEnabled = assignment.scoring_enabled !== false;
    const persistedScore = scoringEnabled ? (evaluation.score ?? 0) : 100;
    // Practice sessions: feedback releases directly, never any passback.
    const reviewStatus = sessionRow.is_practice
      ? null
      : resolveReviewStatus(assignment.feedback_release_mode, evaluation.criteria_evaluations);
    const isInstructorReview = reviewStatus === 'pending_review';

    await pool.query(
      `UPDATE simulation_sessions
       SET score = $1,
           score_breakdown = $2::jsonb,
           ai_evaluation = $3::jsonb,
           review_status = $4,
           evaluation_status = NULL,
           evaluation_error = NULL,
           next_evaluation_at = NULL
       WHERE id = $5`,
      [
        persistedScore,
        JSON.stringify({
          criteria_evaluations: evaluation.criteria_evaluations,
          ...(evaluation.consistency_notes && { consistency_notes: evaluation.consistency_notes }),
        }),
        JSON.stringify({
          overall_feedback: evaluation.overall_feedback,
          fallback: evaluation.fallback || false,
          scoring_enabled: scoringEnabled,
          evaluated_at: new Date().toISOString(),
          recovered_by_retry: true,
        }),
        reviewStatus,
        sessionId,
      ]
    );

    console.log(`[evaluation-retry] session ${sessionId} evaluated successfully on retry (attempt ${sessionRow.evaluation_attempts + 1})`);

    // Immediate mode: the deferred grade goes out now, using the LTI context
    // captured at completion. Instructor-review mode defers to Release.
    // Practice sessions never touch the gradebook.
    if (!isInstructorReview && !sessionRow.is_practice) {
      await submitGradeForSession({
        sessionId,
        score: persistedScore,
        maxScore: assignment.max_score,
        scoringEnabled,
        ltiGradeContext: sessionRow.lti_grade_context,
      });
    }
    return { success: true };
  } catch (err) {
    const error = err.message || 'AI evaluation retry failed';
    const newCount = Number(sessionRow.evaluation_attempts) + 1;
    try {
      if (newCount >= MAX_ATTEMPTS) {
        await pool.query(
          `UPDATE simulation_sessions
           SET evaluation_status = 'failed_permanent',
               evaluation_attempts = $2,
               next_evaluation_at = NULL,
               evaluation_error = $3
           WHERE id = $1`,
          [sessionId, newCount, error]
        );
        console.error(`[evaluation-retry] session ${sessionId} evaluation failed permanently after ${newCount} attempts: ${error}`);
      } else {
        await pool.query(
          `UPDATE simulation_sessions
           SET evaluation_status = 'pending_evaluation',
               evaluation_attempts = $2,
               next_evaluation_at = NOW() + make_interval(mins => $3),
               evaluation_error = $4
           WHERE id = $1`,
          [sessionId, newCount, BACKOFF_MINUTES[newCount - 1], error]
        );
        console.warn(`[evaluation-retry] session ${sessionId} evaluation failed (attempt ${newCount}), will retry: ${error}`);
      }
    } catch (dbErr) {
      console.error(`[evaluation-retry] failed to record retry outcome for session ${sessionId}:`, dbErr.message);
    }
    return { success: false, error };
  }
}

let ticking = false;

// One worker pass: recover stuck claims, claim due sessions (FOR UPDATE SKIP
// LOCKED so a second process can never double-claim), then evaluate outside
// any transaction.
async function runEvaluationRetryTick() {
  if (ticking) return;
  ticking = true;
  try {
    await pool.query(
      `UPDATE simulation_sessions SET evaluation_status = 'pending_evaluation'
       WHERE evaluation_status = 'evaluating' AND next_evaluation_at < NOW() - interval '15 minutes'`
    );

    const client = await pool.connect();
    let claimed = [];
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, assignment_id, evaluation_attempts, lti_grade_context, is_practice
         FROM simulation_sessions
         WHERE evaluation_status = 'pending_evaluation' AND next_evaluation_at <= NOW()
         ORDER BY next_evaluation_at ASC
         LIMIT ${CLAIM_BATCH}
         FOR UPDATE SKIP LOCKED`
      );
      if (rows.length > 0) {
        await client.query(
          `UPDATE simulation_sessions
           SET evaluation_status = 'evaluating', next_evaluation_at = NOW()
           WHERE id = ANY($1)`,
          [rows.map((r) => r.id)]
        );
      }
      await client.query('COMMIT');
      claimed = rows;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    for (const row of claimed) {
      await processSession(row);
    }
  } catch (err) {
    console.error('[evaluation-retry] worker tick error:', err.message);
  } finally {
    ticking = false;
  }
}

function startEvaluationRetryWorker({ intervalMs = 60_000 } = {}) {
  const timer = setInterval(runEvaluationRetryTick, intervalMs);
  if (timer.unref) timer.unref();
  console.log(`[evaluation-retry] worker started (every ${Math.round(intervalMs / 1000)}s)`);
  return { stop: () => clearInterval(timer) };
}

module.exports = {
  processSession,
  runEvaluationRetryTick,
  startEvaluationRetryWorker,
  BACKOFF_MINUTES,
  MAX_ATTEMPTS,
};
