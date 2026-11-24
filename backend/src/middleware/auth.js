const pool = require('../config/database');
const { resolveLaunch } = require('../utils/launch');

// Verify the session token and load the launch it belongs to.
//   req.ltiToken   decoded token (plus ltiContextId: the course's LTI context)
//   req.platformId lti_platforms.id
//   req.launch     launch_contexts row: user_id, course_id, lti_context_id,
//                  roles, is_instructor, is_instance_admin
const verifyLTI = async (req, res, next) => {
  try {
    const token = req.query.ltik || req.body?.ltik || req.headers['x-lti-token'];
    const { decoded, platformId, launch } = await resolveLaunch(token);
    decoded.ltiContextId = launch.lti_context_id;
    req.ltiToken = decoded;
    req.platformId = platformId;
    req.launch = launch;
    next();
  } catch (error) {
    if (!error.status) console.error('LTI verification error:', error);
    return res.status(401).json({ error: error.status ? error.message : 'Authentication failed' });
  }
};

// Instructor (or instance administrator) in the launched course.
const verifyInstructor = (req, res, next) => {
  if (!req.launch?.is_instructor) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

// Administrator of the LMS this instance serves (see utils/roles.js).
const verifyInstanceAdmin = (req, res, next) => {
  if (!req.launch?.is_instance_admin) {
    return res.status(403).json({ error: 'Instance administrator access required' });
  }
  next();
};

// The LTI context (course) of the launch this token belongs to.
function getContextId(token) {
  return token.ltiContextId;
}

// Verify session belongs to the requesting platform (prevents cross-platform access)
const verifySessionAccess = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    const result = await pool.query(
      `SELECT s.id FROM simulation_sessions s
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.id = $1 AND a.platform_id = $2`,
      [sessionId, req.platformId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    next();
  } catch (error) {
    console.error('Session access verification error:', error);
    return res.status(500).json({ error: 'Failed to verify session access' });
  }
};

module.exports = { verifyLTI, verifyInstructor, verifyInstanceAdmin, getContextId, verifySessionAccess };
