// Launch contexts: recording what a launch said, and resolving a session
// token (ltik) back to it. See db/migrations/002_launch_contexts.sql.
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { classifyRoles } = require('./roles');

const sessionHours = () => Number(process.env.LTI_SESSION_HOURS) > 0 ? Number(process.env.LTI_SESSION_HOURS) : 24;

/**
 * Record a launch: upsert course, user, enrollment and the launch context.
 * `token` is the ltijs id token; `platformId` our lti_platforms.id; `ltik`
 * the session token ltijs issued for this launch. Runs in one transaction.
 * `noCourse` marks a launch from outside any course (the LMS's admin menu):
 * its context is an account, which must not be recorded as a course.
 */
async function recordLaunch(token, platformId, ltik, { noCourse = false } = {}) {
  const ctx = token.platformContext || {};
  const roles = ctx.roles || [];
  const ltiUserId = token.user;
  const name = token.userInfo?.name || null;
  const email = token.userInfo?.email || null;
  const contextId = noCourse ? null : (ctx.context?.id || null);
  const contextTitle = ctx.context?.title || ctx.context?.label || 'Untitled course';
  const { isInstanceAdmin, isInstructor } = classifyRoles(roles, { ltiUserId, email });
  const ltikContextId = jwt.decode(ltik)?.contextId;
  if (!ltikContextId) throw new Error('launch token carries no context');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let courseId = null;
    if (contextId) {
      const course = await client.query(
        `INSERT INTO courses (lti_context_id, name, platform_id) VALUES ($1, $2, $3)
         ON CONFLICT (platform_id, lti_context_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [contextId, contextTitle, platformId]
      );
      courseId = course.rows[0].id;
    }

    const user = await client.query(
      `INSERT INTO users (lti_user_id, name, email, roles, platform_id) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (platform_id, lti_user_id)
       DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, roles = EXCLUDED.roles, updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [ltiUserId, name, email, roles, platformId]
    );
    const userId = user.rows[0].id;

    if (courseId) {
      await client.query(
        `INSERT INTO course_enrollments (course_id, user_id, role, first_access, last_access)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (course_id, user_id)
         DO UPDATE SET last_access = CURRENT_TIMESTAMP, role = EXCLUDED.role`,
        [courseId, userId, isInstructor ? 'Instructor' : 'Student']
      );
    }

    await client.query(
      `INSERT INTO launch_contexts
         (platform_id, ltik_context_id, lti_user_id, user_id, course_id, lti_context_id,
          roles, is_instructor, is_instance_admin, launched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
       ON CONFLICT (platform_id, ltik_context_id, lti_user_id)
       DO UPDATE SET user_id = EXCLUDED.user_id, course_id = EXCLUDED.course_id,
                     lti_context_id = EXCLUDED.lti_context_id, roles = EXCLUDED.roles,
                     is_instructor = EXCLUDED.is_instructor,
                     is_instance_admin = EXCLUDED.is_instance_admin,
                     launched_at = CURRENT_TIMESTAMP`,
      [platformId, ltikContextId, ltiUserId, userId, courseId, contextId, roles, isInstructor, isInstanceAdmin]
    );

    await client.query('COMMIT');
    return { userId, courseId, isInstructor, isInstanceAdmin };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Resolve a session token to { decoded, platformId, launch }.
 * Throws an Error with .status (401) and a short .message on any failure.
 */
async function resolveLaunch(ltik) {
  const fail = (message) => Object.assign(new Error(message), { status: 401 });
  if (!ltik) throw fail('No LTI token provided');

  let decoded;
  try {
    decoded = jwt.verify(ltik, process.env.LTI_KEY);
  } catch {
    throw fail('Invalid LTI token');
  }
  if (!decoded || !decoded.platformUrl || !decoded.contextId || !decoded.user) throw fail('Invalid LTI token');

  const { rows } = await pool.query(
    `SELECT lc.*, p.registration_status,
            EXTRACT(EPOCH FROM (LOCALTIMESTAMP - lc.launched_at)) / 3600 AS age_hours
       FROM lti_platforms p
       JOIN launch_contexts lc ON lc.platform_id = p.id
      WHERE p.url = $1 AND lc.ltik_context_id = $2 AND lc.lti_user_id = $3`,
    [decoded.platformUrl, decoded.contextId, decoded.user]
  );
  const launch = rows[0];
  if (!launch || launch.registration_status === 'disabled') throw fail('Unknown launch; relaunch from your LMS');

  if (Number(launch.age_hours) > sessionHours()) throw fail('Session expired; relaunch from your LMS');

  return { decoded, platformId: launch.platform_id, launch };
}

module.exports = { recordLaunch, resolveLaunch };
