const pool = require('../config/database');
// Required as a module object (not destructured) so tests can monkey-patch
// publishGrade, and so the worker picks up the fresh-token helpers.
const ltiGrade = require('./lti-grade');

// One grade_submissions row per passback *intent*; retries mutate the row in
// place. Status lifecycle:
//   submitted        — accepted by the LMS
//   pending_retry    — failed, scheduled for another attempt
//   retrying         — claimed by the worker (transient)
//   failed_permanent — exhausted all attempts; only manual Retry revives it
//   superseded       — a newer submission for the same session replaced it
//   failed / pending — legacy pre-v10 rows; never auto-retried
const BACKOFF_MINUTES = [1, 10, 60, 360, 1440];
const MAX_ATTEMPTS = 1 + BACKOFF_MINUTES.length;
const CLAIM_BATCH = 10;

function wireValues({ score, maxScore, scoringEnabled }) {
  const scoreGiven = scoringEnabled ? Number(score) || 0 : 1;
  const scoreMaximum = scoringEnabled ? Number(maxScore) || 100 : 1;
  const displayScore = Number.isFinite(Number(score)) ? Number(score) : scoreGiven;
  return { scoreGiven, scoreMaximum, displayScore };
}

async function tryPublish(context, scoreGiven, comment, scoreMaximum) {
  if (!context || !context.platformContext?.endpoint) {
    return 'Stored LTI context or AGS endpoint not available';
  }
  try {
    await ltiGrade.publishGrade(context, scoreGiven, comment || undefined, scoreMaximum);
    return null;
  } catch (err) {
    return err.message || 'Grade passback failed';
  }
}

/**
 * Single entry point for all passback call sites. Attempts the publish once;
 * on failure records a pending_retry row the worker will pick up. Must be
 * called AFTER the caller's transaction commits — runs on pool connections.
 *
 * Returns { success, queued, score, error?, submissionId } — callers expose
 * `success`/`error` to the frontend like the legacy inline code did.
 */
async function submitGradeForSession({ sessionId, score, maxScore, scoringEnabled = true, comment, ltiGradeContext }) {
  const { scoreGiven, scoreMaximum, displayScore } = wireValues({ score, maxScore, scoringEnabled });

  // A newer grade for this session replaces anything still queued — prevents
  // the worker from later overwriting a newer LMS grade with a stale score.
  await pool.query(
    `UPDATE grade_submissions SET status = 'superseded'
     WHERE session_id = $1 AND status IN ('pending_retry', 'retrying')`,
    [sessionId]
  );

  const error = await tryPublish(ltiGradeContext, scoreGiven, comment, scoreMaximum);

  if (!error) {
    const ins = await pool.query(
      `INSERT INTO grade_submissions
         (session_id, score, score_given, score_maximum, comment, status, attempt_count, last_attempt_at)
       VALUES ($1, $2, $3, $4, $5, 'submitted', 1, NOW())
       RETURNING id`,
      [sessionId, displayScore, scoreGiven, scoreMaximum, comment || null]
    );
    return { success: true, queued: false, score: displayScore, submissionId: ins.rows[0].id };
  }

  console.warn(`[grade-passback] session ${sessionId} passback failed, queued for retry: ${error}`);
  const ins = await pool.query(
    `INSERT INTO grade_submissions
       (session_id, score, score_given, score_maximum, comment, status, attempt_count,
        last_attempt_at, next_attempt_at, error_message)
     VALUES ($1, $2, $3, $4, $5, 'pending_retry', 1, NOW(), NOW() + make_interval(mins => $6), $7)
     RETURNING id`,
    [sessionId, displayScore, scoreGiven, scoreMaximum, comment || null, BACKOFF_MINUTES[0], error]
  );
  return { success: false, queued: true, score: displayScore, error, submissionId: ins.rows[0].id };
}

/**
 * Retry one existing row (worker or manual Retry). Tries the session's stored
 * lti_grade_context first; if that fails, re-reads a fresh token from the
 * ltijs tables. Updates the row terminally; never throws.
 */
async function attemptSubmissionRow(row) {
  let error = 'Unknown error';
  try {
    const { rows } = await pool.query(
      'SELECT lti_grade_context FROM simulation_sessions WHERE id = $1',
      [row.session_id]
    );
    const storedContext = rows[0]?.lti_grade_context || null;

    error = await tryPublish(storedContext, Number(row.score_given), row.comment, Number(row.score_maximum));

    if (error) {
      // Fresh-token fallback: rebuild from the snapshot's identifiers, or
      // from session joins when no snapshot exists at all.
      let freshToken = null;
      try {
        const decoded = ltiGrade.decodedLtikFromContext(storedContext);
        if (decoded && decoded.platformUrl && decoded.user) {
          freshToken = await ltiGrade.getLtiIdToken(decoded);
        }
        if (!freshToken) {
          freshToken = await ltiGrade.getLtiIdTokenForSession(row.session_id);
        }
      } catch (e) {
        console.warn(`[grade-passback] fresh-token rebuild failed for session ${row.session_id}: ${e.message}`);
      }
      if (freshToken) {
        const freshError = await tryPublish(freshToken, Number(row.score_given), row.comment, Number(row.score_maximum));
        if (!freshError) error = null;
      }
    }
  } catch (err) {
    error = err.message || 'Grade passback retry failed';
  }

  try {
    if (!error) {
      await pool.query(
        `UPDATE grade_submissions
         SET status = 'submitted', submitted_at = NOW(), last_attempt_at = NOW(),
             attempt_count = attempt_count + 1, next_attempt_at = NULL, error_message = NULL
         WHERE id = $1`,
        [row.id]
      );
      console.log(`[grade-passback] session ${row.session_id} passback succeeded on retry (submission ${row.id})`);
      return { success: true };
    }

    const newCount = Number(row.attempt_count) + 1;
    if (newCount >= MAX_ATTEMPTS) {
      await pool.query(
        `UPDATE grade_submissions
         SET status = 'failed_permanent', attempt_count = $2, last_attempt_at = NOW(),
             next_attempt_at = NULL, error_message = $3
         WHERE id = $1`,
        [row.id, newCount, error]
      );
      console.error(`[grade-passback] session ${row.session_id} passback failed permanently after ${newCount} attempts: ${error}`);
    } else {
      await pool.query(
        `UPDATE grade_submissions
         SET status = 'pending_retry', attempt_count = $2, last_attempt_at = NOW(),
             next_attempt_at = NOW() + make_interval(mins => $3), error_message = $4
         WHERE id = $1`,
        [row.id, newCount, BACKOFF_MINUTES[newCount - 1], error]
      );
    }
    return { success: false, error };
  } catch (dbErr) {
    console.error(`[grade-passback] failed to record retry outcome for submission ${row.id}:`, dbErr.message);
    return { success: false, error: dbErr.message };
  }
}

let ticking = false;

// One worker pass: recover stuck rows, claim due retries (FOR UPDATE SKIP
// LOCKED so a second process can never double-claim), then publish outside
// any transaction. Catches everything — server.js exits on unhandledRejection.
async function runWorkerTick() {
  if (ticking) return;
  ticking = true;
  try {
    await pool.query(
      `UPDATE grade_submissions SET status = 'pending_retry'
       WHERE status = 'retrying' AND last_attempt_at < NOW() - interval '10 minutes'`
    );

    const client = await pool.connect();
    let claimed = [];
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT * FROM grade_submissions
         WHERE status = 'pending_retry' AND next_attempt_at <= NOW()
         ORDER BY next_attempt_at ASC
         LIMIT ${CLAIM_BATCH}
         FOR UPDATE SKIP LOCKED`
      );
      if (rows.length > 0) {
        await client.query(
          `UPDATE grade_submissions SET status = 'retrying', last_attempt_at = NOW() WHERE id = ANY($1)`,
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
      await attemptSubmissionRow(row);
    }
  } catch (err) {
    console.error('[grade-passback] worker tick error:', err.message);
  } finally {
    ticking = false;
  }
}

function startGradePassbackWorker({ intervalMs = 60_000 } = {}) {
  const timer = setInterval(runWorkerTick, intervalMs);
  if (timer.unref) timer.unref();
  console.log(`[grade-passback] retry worker started (every ${Math.round(intervalMs / 1000)}s)`);
  return { stop: () => clearInterval(timer) };
}

module.exports = {
  submitGradeForSession,
  attemptSubmissionRow,
  runWorkerTick,
  startGradePassbackWorker,
  BACKOFF_MINUTES,
  MAX_ATTEMPTS,
};
