const pool = require('../config/database');

// Fire-and-forget audit logger.
// Every consequential administrative action should call this. Errors are
// logged to the console but never thrown — auditing is a best-effort side
// channel and must not block or fail the main request path.
//
// The table is defined in db/migrations/001_baseline.sql.

/**
 * Log an audit event.
 *
 * @param {object}   opts
 * @param {string}   opts.actor_type           - 'instance_admin' | 'instructor_lti' | 'learner_lti' | 'system'
 * @param {number?}  opts.actor_id             - ID of the acting user
 * @param {string}   opts.event_type           - e.g. 'login_success', 'rubric_edit', 'session_release'
 * @param {string?}  opts.subject_type         - e.g. 'assignment', 'session', 'platform'
 * @param {number?}  opts.subject_id           - ID of the subject entity
 * @param {object?}  opts.metadata             - Arbitrary JSON context (diffs, reasons, request info)
 * @param {object?}  opts.req                  - Optional Express request — pulls IP and user agent
 */
async function logAuditEvent(opts) {
  const {
    actor_type,
    actor_id = null,
    event_type,
    subject_type = null,
    subject_id = null,
    metadata = {},
    req = null,
  } = opts || {};

  if (!actor_type || !event_type) {
    console.warn('[audit] missing required fields (actor_type, event_type); skipping');
    return;
  }

  const ip_address = req ? (req.ip || req.headers?.['x-forwarded-for'] || req.connection?.remoteAddress || null) : null;
  const user_agent = req ? (req.headers?.['user-agent'] || null) : null;

  try {
    await pool.query(
      `INSERT INTO audit_events
        (actor_type, actor_id, event_type,
         subject_type, subject_id, metadata, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        actor_type,
        actor_id,
        event_type,
        subject_type,
        subject_id,
        JSON.stringify(metadata || {}),
        ip_address,
        user_agent,
      ]
    );
  } catch (err) {
    console.error('[audit] failed to write event:', err.message, { event_type, actor_type });
  }
}

module.exports = { logAuditEvent };
