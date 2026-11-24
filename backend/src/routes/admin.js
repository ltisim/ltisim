const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { getProviderForAssignment, buildSystemPrompt, getChatOptions } = require('../services/ai/index');
const { getDeepLinkToken, removeDeepLinkToken } = require('../config/lti');
const lti = require('ltijs').Provider;
const { verifyLTI, verifyInstructor, getContextId } = require('../middleware/auth');
const aiModels = require('../services/ai/models');
const { sanitizeLearningContent } = require('../utils/sanitize-learning-content');
const { sanitizeStages, sanitizeArtifactConfig, sanitizeExaminerConfig, sanitizeVoiceConfig } = require('../utils/assignment-extras');
const { logAiUsage } = require('../utils/ai-usage');
const { checkAiQuota } = require('../utils/ai-quota');
const { regradeSessionById, regradePendingForAssignment } = require('../utils/regrade');
const { releaseSessionById } = require('../utils/release-session');
const { submitGradeForSession, attemptSubmissionRow } = require('../utils/grade-passback');
const { syncVocabulary, deleteVocabulary } = require('../services/transcribe-vocab');

const ALLOWED_ASSIGNMENT_TYPES = ['simulation', 'llm_interaction', 'staged_simulation', 'simulation_with_artifact', 'ai_examiner'];
const ALLOWED_RELEASE_MODES = ['immediate', 'instructor_review', 'confidence_gated'];

const {
  MAX_EXEMPLARS_PER_CRITERION,
  MAX_EXEMPLAR_EXCERPT_CHARS,
  MAX_EXEMPLAR_EXPLANATION_CHARS,
  validateRubricShape,
  sanitizeRubricExemplars,
} = require('../utils/rubric');

// Get all sessions for a course/context
router.get('/sessions', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const contextId = getContextId(req.ltiToken);

    const result = await pool.query(
      `SELECT
        s.id,
        s.started_at,
        s.completed_at,
        s.score,
        s.status,
        s.review_status,
        s.evaluation_status,
        s.assignment_id,
        s.user_id,
        s.is_practice,
        u.name as student_name,
        u.email as student_email,
        u.lti_user_id,
        a.title as assignment_title,
        (SELECT COUNT(*) FROM simulation_interactions WHERE session_id = s.id) as interaction_count,
        (SELECT COUNT(*) FROM session_feedback WHERE session_id = s.id) as feedback_count,
        (SELECT gs.status FROM grade_submissions gs
          WHERE gs.session_id = s.id ORDER BY gs.id DESC LIMIT 1) as grade_passback_status
       FROM simulation_sessions s
       JOIN users u ON s.user_id = u.id
       JOIN assignments a ON s.assignment_id = a.id
       WHERE a.lti_context_id = $1 AND a.platform_id = $2
       ORDER BY s.started_at DESC`,
      [contextId, req.platformId]
    );

    res.json({ sessions: result.rows });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Get detailed session information including all interactions
router.get('/sessions/:sessionId', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Get session details with new fields
    const sessionResult = await pool.query(
      `SELECT
        s.*,
        u.name as student_name,
        u.email as student_email,
        u.lti_user_id,
        u.roles as student_roles,
        a.title as assignment_title,
        a.lti_context_id,
        a.rubric as assignment_rubric,
        a.scoring_enabled as assignment_scoring_enabled,
        a.feedback_release_mode,
        a.assignment_type
       FROM simulation_sessions s
       JOIN users u ON s.user_id = u.id
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.id = $1 AND a.platform_id = $2`,
      [sessionId, req.platformId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];

    // Get all interactions
    const interactionsResult = await pool.query(
      `SELECT * FROM simulation_interactions
       WHERE session_id = $1
       ORDER BY timestamp ASC`,
      [sessionId]
    );

    // Get feedback
    const feedbackResult = await pool.query(
      `SELECT
        f.*,
        u.name as instructor_name,
        u.email as instructor_email
       FROM session_feedback f
       JOIN users u ON f.instructor_id = u.id
       WHERE f.session_id = $1
       ORDER BY f.created_at DESC`,
      [sessionId]
    );

    // Get grade submissions
    const gradesResult = await pool.query(
      `SELECT * FROM grade_submissions
       WHERE session_id = $1
       ORDER BY id DESC`,
      [sessionId]
    );

    res.json({
      session,
      interactions: interactionsResult.rows,
      feedback: feedbackResult.rows,
      gradeSubmissions: gradesResult.rows
    });
  } catch (error) {
    console.error('Error fetching session details:', error);
    res.status(500).json({ error: 'Failed to fetch session details' });
  }
});

// Add feedback to a session
router.post('/sessions/:sessionId/feedback', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { feedbackText, rating, flagged } = req.body;

    if (!feedbackText) {
      return res.status(400).json({ error: 'Feedback text is required' });
    }

    if (rating && (rating < 1 || rating > 5)) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const token = req.ltiToken;
    const ltiUserId = token.user;

    let instructorResult = await pool.query(
      'SELECT id FROM users WHERE lti_user_id = $1 AND platform_id = $2',
      [ltiUserId, req.platformId]
    );

    if (instructorResult.rows.length === 0) {
      const userInfo = token.userInfo;
      instructorResult = await pool.query(
        `INSERT INTO users (lti_user_id, name, email, roles, platform_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [ltiUserId, userInfo.name, userInfo.email, token.platformContext?.roles || [], req.platformId]
      );
    }

    const instructorId = instructorResult.rows[0].id;

    const result = await pool.query(
      `INSERT INTO session_feedback
       (session_id, instructor_id, feedback_text, rating, flagged)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [sessionId, instructorId, feedbackText, rating || null, flagged || false]
    );

    const feedbackWithInstructor = await pool.query(
      `SELECT f.*, u.name as instructor_name, u.email as instructor_email
       FROM session_feedback f
       JOIN users u ON f.instructor_id = u.id
       WHERE f.id = $1`,
      [result.rows[0].id]
    );

    res.json({ feedback: feedbackWithInstructor.rows[0] });
  } catch (error) {
    console.error('Error adding feedback:', error);
    res.status(500).json({ error: 'Failed to add feedback' });
  }
});

// Update feedback
router.put('/feedback/:feedbackId', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const { feedbackText, rating, flagged } = req.body;

    const token = req.ltiToken;
    const ltiUserId = token.user;

    const instructorResult = await pool.query(
      'SELECT id FROM users WHERE lti_user_id = $1 AND platform_id = $2',
      [ltiUserId, req.platformId]
    );

    if (instructorResult.rows.length === 0) {
      return res.status(403).json({ error: 'User not found' });
    }

    const instructorId = instructorResult.rows[0].id;

    const feedbackCheck = await pool.query(
      'SELECT instructor_id FROM session_feedback WHERE id = $1',
      [feedbackId]
    );

    if (feedbackCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    if (feedbackCheck.rows[0].instructor_id !== instructorId) {
      return res.status(403).json({ error: 'You can only edit your own feedback' });
    }

    const result = await pool.query(
      `UPDATE session_feedback
       SET feedback_text = COALESCE($1, feedback_text),
           rating = COALESCE($2, rating),
           flagged = COALESCE($3, flagged),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [feedbackText, rating, flagged, feedbackId]
    );

    res.json({ feedback: result.rows[0] });
  } catch (error) {
    console.error('Error updating feedback:', error);
    res.status(500).json({ error: 'Failed to update feedback' });
  }
});

// Delete feedback
router.delete('/feedback/:feedbackId', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { feedbackId } = req.params;

    const token = req.ltiToken;
    const ltiUserId = token.user;

    const instructorResult = await pool.query(
      'SELECT id FROM users WHERE lti_user_id = $1 AND platform_id = $2',
      [ltiUserId, req.platformId]
    );

    if (instructorResult.rows.length === 0) {
      return res.status(403).json({ error: 'User not found' });
    }

    const instructorId = instructorResult.rows[0].id;

    const feedbackCheck = await pool.query(
      'SELECT instructor_id FROM session_feedback WHERE id = $1',
      [feedbackId]
    );

    if (feedbackCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    if (feedbackCheck.rows[0].instructor_id !== instructorId) {
      return res.status(403).json({ error: 'You can only delete your own feedback' });
    }

    await pool.query('DELETE FROM session_feedback WHERE id = $1', [feedbackId]);

    res.json({ success: true, message: 'Feedback deleted' });
  } catch (error) {
    console.error('Error deleting feedback:', error);
    res.status(500).json({ error: 'Failed to delete feedback' });
  }
});

// Get statistics for the course
router.get('/stats', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const contextId = getContextId(req.ltiToken);

    const stats = await pool.query(
      `SELECT
        COUNT(DISTINCT s.id) as total_sessions,
        COUNT(DISTINCT s.user_id) as unique_students,
        COUNT(DISTINCT CASE WHEN s.status = 'completed' THEN s.id END) as completed_sessions,
        COUNT(DISTINCT CASE WHEN s.status = 'in_progress' THEN s.id END) as in_progress_sessions,
        ROUND(AVG(CASE WHEN s.score IS NOT NULL THEN s.score END), 2) as average_score,
        ROUND(MIN(CASE WHEN s.score IS NOT NULL THEN s.score END), 2) as min_score,
        ROUND(MAX(CASE WHEN s.score IS NOT NULL THEN s.score END), 2) as max_score,
        COUNT(DISTINCT f.id) as total_feedback
       FROM simulation_sessions s
       JOIN assignments a ON s.assignment_id = a.id
       LEFT JOIN session_feedback f ON s.id = f.session_id
       WHERE a.lti_context_id = $1 AND a.platform_id = $2`,
      [contextId, req.platformId]
    );

    res.json({ stats: stats.rows[0] });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get current course details
router.get('/course', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const contextId = getContextId(req.ltiToken);

    const courseResult = await pool.query(
      `SELECT
        c.*,
        p.url as platform_url,
        COUNT(DISTINCT ce.user_id) as total_enrollments,
        COUNT(DISTINCT CASE WHEN ce.role LIKE '%Instructor%' OR ce.role LIKE '%Teacher%' THEN ce.user_id END) as instructor_count,
        COUNT(DISTINCT CASE WHEN ce.role LIKE '%Student%' THEN ce.user_id END) as student_count
       FROM courses c
       JOIN lti_platforms p ON c.platform_id = p.id
       LEFT JOIN course_enrollments ce ON c.id = ce.course_id
       WHERE c.lti_context_id = $1 AND c.platform_id = $2
       GROUP BY c.id, p.url`,
      [contextId, req.platformId]
    );

    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    res.json({ course: courseResult.rows[0] });
  } catch (error) {
    console.error('Error fetching course:', error);
    res.status(500).json({ error: 'Failed to fetch course details' });
  }
});

// Get all enrollments for the current course
router.get('/course/enrollments', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const contextId = getContextId(req.ltiToken);

    const enrollmentsResult = await pool.query(
      `SELECT
        ce.id,
        ce.role,
        ce.first_access,
        ce.last_access,
        u.name,
        u.email,
        u.lti_user_id,
        u.roles as all_roles,
        COUNT(DISTINCT s.id) as session_count,
        COUNT(DISTINCT CASE WHEN s.status = 'completed' THEN s.id END) as completed_count,
        ROUND(AVG(CASE WHEN s.score IS NOT NULL THEN s.score END), 2) as avg_score
       FROM course_enrollments ce
       JOIN users u ON ce.user_id = u.id
       JOIN courses c ON ce.course_id = c.id
       LEFT JOIN simulation_sessions s ON s.user_id = u.id
       WHERE c.lti_context_id = $1 AND c.platform_id = $2
       GROUP BY ce.id, ce.role, ce.first_access, ce.last_access, u.name, u.email, u.lti_user_id, u.roles
       ORDER BY ce.last_access DESC`,
      [contextId, req.platformId]
    );

    res.json({ enrollments: enrollmentsResult.rows });
  } catch (error) {
    console.error('Error fetching enrollments:', error);
    res.status(500).json({ error: 'Failed to fetch course enrollments' });
  }
});

// Course roster: students × assignments completion matrix. Three flat result
// sets (assignments, student enrollments, sessions) — the frontend assembles
// the grid. Sessions are scoped to THIS course's assignments (unlike the
// legacy /course/enrollments join, which counted a user's sessions from every
// course they were ever in).
router.get('/course/roster', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const contextId = getContextId(req.ltiToken);

    const [assignmentsResult, studentsResult, sessionsResult] = await Promise.all([
      pool.query(
        `SELECT id, title, assignment_type, is_published, max_sessions, scoring_enabled, max_score
         FROM assignments
         WHERE lti_context_id = $1 AND platform_id = $2
         ORDER BY created_at ASC`,
        [contextId, req.platformId]
      ),
      pool.query(
        `SELECT u.id AS user_id, u.name, u.email, ce.role, ce.first_access, ce.last_access
         FROM course_enrollments ce
         JOIN users u ON ce.user_id = u.id
         JOIN courses c ON ce.course_id = c.id
         WHERE c.lti_context_id = $1 AND c.platform_id = $2
           AND ce.role NOT ILIKE '%instructor%'
           AND ce.role NOT ILIKE '%teacher%'
           AND ce.role NOT ILIKE '%admin%'
           AND ce.role NOT ILIKE '%teachingassistant%'
         ORDER BY u.name ASC`,
        [contextId, req.platformId]
      ),
      pool.query(
        `SELECT s.id, s.user_id, s.assignment_id, s.status, s.review_status,
                s.evaluation_status, s.score, s.started_at, s.completed_at
         FROM simulation_sessions s
         JOIN assignments a ON s.assignment_id = a.id
         WHERE a.lti_context_id = $1 AND a.platform_id = $2 AND NOT s.is_practice
         ORDER BY s.started_at ASC`,
        [contextId, req.platformId]
      ),
    ]);

    res.json({
      assignments: assignmentsResult.rows,
      students: studentsResult.rows,
      sessions: sessionsResult.rows,
    });
  } catch (error) {
    console.error('Error fetching roster:', error);
    res.status(500).json({ error: 'Failed to fetch course roster' });
  }
});

// Update course details
router.put('/course', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const contextId = getContextId(req.ltiToken);
    const { name, metadata } = req.body;

    if (!name && !metadata) {
      return res.status(400).json({ error: 'No update data provided' });
    }

    let query = 'UPDATE courses SET updated_at = CURRENT_TIMESTAMP';
    const params = [];
    let paramIndex = 1;

    if (name) {
      params.push(name);
      query += `, name = $${paramIndex}`;
      paramIndex++;
    }

    if (metadata) {
      params.push(JSON.stringify(metadata));
      query += `, metadata = $${paramIndex}::jsonb`;
      paramIndex++;
    }

    params.push(contextId);
    query += ` WHERE lti_context_id = $${paramIndex}`;
    paramIndex++;
    params.push(req.platformId);
    query += ` AND platform_id = $${paramIndex} RETURNING *`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    res.json({ course: result.rows[0] });
  } catch (error) {
    console.error('Error updating course:', error);
    res.status(500).json({ error: 'Failed to update course' });
  }
});

// Get all assignments for the current course
router.get('/assignments', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const contextId = getContextId(req.ltiToken);

    const assignmentsResult = await pool.query(
      `SELECT
        a.id,
        a.title,
        a.description,
        a.is_published,
        a.persona_name,
        a.assignment_type,
        a.system_prompt IS NOT NULL AND a.system_prompt != '' AS has_ai_config,
        a.created_at,
        a.updated_at,
        COUNT(DISTINCT s.id) as session_count,
        COUNT(DISTINCT s.user_id) as unique_students,
        COUNT(DISTINCT CASE WHEN s.status = 'completed' THEN s.id END) as completed_count,
        ROUND(AVG(CASE WHEN s.score IS NOT NULL THEN s.score END), 2) as avg_score,
        COUNT(DISTINCT CASE WHEN s.review_status = 'pending_review' THEN s.id END) as pending_review_count
       FROM assignments a
       LEFT JOIN simulation_sessions s ON s.assignment_id = a.id AND NOT s.is_practice
       WHERE a.lti_context_id = $1 AND a.platform_id = $2
       GROUP BY a.id, a.title, a.description, a.is_published, a.persona_name, a.assignment_type, a.system_prompt, a.created_at, a.updated_at
       ORDER BY a.created_at DESC`,
      [contextId, req.platformId]
    );

    res.json({ assignments: assignmentsResult.rows });
  } catch (error) {
    console.error('Error fetching assignments:', error);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

// Get single assignment with all config fields (instructor)
router.get('/assignments/:assignmentId', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const result = await pool.query(
      'SELECT * FROM assignments WHERE id = $1 AND platform_id = $2',
      [assignmentId, req.platformId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    res.json({ assignment: result.rows[0] });
  } catch (error) {
    console.error('Error fetching assignment:', error);
    res.status(500).json({ error: 'Failed to fetch assignment' });
  }
});

// The AI provider this instance uses and the models instructors may pick
router.get('/ai-models', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    res.json(await aiModels.describe());
  } catch (error) {
    console.error('Error listing AI models:', error);
    res.status(500).json({ error: 'Failed to list AI models' });
  }
});

// Create a new assignment
router.post('/assignments', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const contextId = getContextId(req.ltiToken);

    if (req.body.ai_provider_config !== undefined) {
      const normalized = await aiModels.normalizeAssignmentAiConfig(req.body.ai_provider_config);
      if (normalized.error) return res.status(400).json({ error: normalized.error });
      req.body.ai_provider_config = normalized.config;
    }

    const {
      title, description, system_prompt, persona_name, persona_description,
      scenario_context, rubric, completion_conditions,
      ai_provider_config, max_score, is_published, welcome_message, scoring_enabled,
      max_sessions, feedback_release_mode,
      assignment_type, learning_content,
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    if (assignment_type !== undefined && !ALLOWED_ASSIGNMENT_TYPES.includes(assignment_type)) {
      return res.status(400).json({ error: `Invalid assignment_type. Allowed: ${ALLOWED_ASSIGNMENT_TYPES.join(', ')}` });
    }
    const safeAssignmentType = assignment_type || 'simulation';

    if (feedback_release_mode !== undefined && !ALLOWED_RELEASE_MODES.includes(feedback_release_mode)) {
      return res.status(400).json({ error: `Invalid feedback_release_mode. Allowed: ${ALLOWED_RELEASE_MODES.join(', ')}` });
    }

    const rubricError = validateRubricShape(rubric);
    if (rubricError) {
      return res.status(400).json({ error: rubricError });
    }
    const safeLearningContent = sanitizeLearningContent(learning_content);

    const courseResult = await pool.query(
      'SELECT id FROM courses WHERE lti_context_id = $1 AND platform_id = $2',
      [contextId, req.platformId]
    );

    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const courseId = courseResult.rows[0].id;
    const resourceLinkId = `assignment_${Date.now()}`;

    const result = await pool.query(
      `INSERT INTO assignments (
        course_id, lti_context_id, lti_resource_link_id, title, description,
        platform_id, system_prompt, persona_name, persona_description,
        scenario_context, rubric, completion_conditions,
        ai_provider_config, max_score, is_published, welcome_message, scoring_enabled,
        max_sessions, feedback_release_mode,
        assignment_type, learning_content, allow_practice, stages, artifact_config,
        examiner_config, voice_config
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
      RETURNING *`,
      [
        courseId, contextId, resourceLinkId, title, description || null,
        req.platformId, system_prompt || null, persona_name || null, persona_description || null,
        scenario_context || null,
        JSON.stringify(sanitizeRubricExemplars(rubric || [], scoring_enabled !== false)),
        JSON.stringify(completion_conditions || {}),
        JSON.stringify(ai_provider_config || {}),
        max_score || 100,
        is_published === true,
        welcome_message || null,
        scoring_enabled !== false,
        max_sessions != null ? max_sessions : 1,
        feedback_release_mode || 'immediate',
        safeAssignmentType,
        safeLearningContent ? JSON.stringify(safeLearningContent) : null,
        req.body.allow_practice === true,
        JSON.stringify(sanitizeStages(req.body.stages)),
        JSON.stringify(sanitizeArtifactConfig(req.body.artifact_config)),
        JSON.stringify(sanitizeExaminerConfig(req.body.examiner_config)),
        JSON.stringify(sanitizeVoiceConfig(req.body.voice_config)),
      ]
    );

    // Fire-and-forget: (re)build the Transcribe custom vocabulary for voice input.
    syncVocabulary(result.rows[0].id);

    res.json({ assignment: result.rows[0] });
  } catch (error) {
    console.error('Error creating assignment:', error);
    res.status(500).json({ error: 'Failed to create assignment' });
  }
});

// Update an assignment
router.put('/assignments/:assignmentId', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const contextId = getContextId(req.ltiToken);

    // Verify assignment belongs to this course and platform
    const check = await pool.query(
      'SELECT id FROM assignments WHERE id = $1 AND lti_context_id = $2 AND platform_id = $3',
      [assignmentId, contextId, req.platformId]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    if (req.body.feedback_release_mode !== undefined && !ALLOWED_RELEASE_MODES.includes(req.body.feedback_release_mode)) {
      return res.status(400).json({ error: `Invalid feedback_release_mode. Allowed: ${ALLOWED_RELEASE_MODES.join(', ')}` });
    }

    const fields = [
      'title', 'description', 'system_prompt', 'persona_name', 'persona_description',
      'scenario_context', 'welcome_message', 'feedback_release_mode',
    ];
    const jsonFields = ['rubric', 'completion_conditions', 'ai_provider_config', 'stages', 'artifact_config', 'examiner_config', 'voice_config'];
    if (req.body.ai_provider_config !== undefined) {
      const normalized = await aiModels.normalizeAssignmentAiConfig(req.body.ai_provider_config);
      if (normalized.error) return res.status(400).json({ error: normalized.error });
      req.body.ai_provider_config = normalized.config;
    }
    if (req.body.stages !== undefined) {
      req.body.stages = sanitizeStages(req.body.stages);
    }
    if (req.body.artifact_config !== undefined) {
      req.body.artifact_config = sanitizeArtifactConfig(req.body.artifact_config);
    }
    if (req.body.examiner_config !== undefined) {
      req.body.examiner_config = sanitizeExaminerConfig(req.body.examiner_config);
    }
    if (req.body.voice_config !== undefined) {
      req.body.voice_config = sanitizeVoiceConfig(req.body.voice_config);
    }

    if (req.body.rubric !== undefined) {
      const rubricError = validateRubricShape(req.body.rubric);
      if (rubricError) {
        return res.status(400).json({ error: rubricError });
      }
      const scoringFlag = req.body.scoring_enabled !== undefined ? req.body.scoring_enabled !== false : true;
      req.body.rubric = sanitizeRubricExemplars(req.body.rubric, scoringFlag);
    }
    const numericFields = ['max_score', 'max_sessions'];
    const boolFields = ['is_published', 'scoring_enabled', 'allow_practice'];

    const setClauses = ['updated_at = CURRENT_TIMESTAMP'];
    const params = [];
    let paramIndex = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        params.push(req.body[field]);
        setClauses.push(`${field} = $${paramIndex}`);
        paramIndex++;
      }
    }

    for (const field of jsonFields) {
      if (req.body[field] !== undefined) {
        params.push(JSON.stringify(req.body[field]));
        setClauses.push(`${field} = $${paramIndex}::jsonb`);
        paramIndex++;
      }
    }

    if (req.body.assignment_type !== undefined) {
      if (!ALLOWED_ASSIGNMENT_TYPES.includes(req.body.assignment_type)) {
        return res.status(400).json({ error: `Invalid assignment_type. Allowed: ${ALLOWED_ASSIGNMENT_TYPES.join(', ')}` });
      }
      params.push(req.body.assignment_type);
      setClauses.push(`assignment_type = $${paramIndex}`);
      paramIndex++;
    }

    if (req.body.learning_content !== undefined) {
      const safeLearningContent = sanitizeLearningContent(req.body.learning_content);
      params.push(safeLearningContent ? JSON.stringify(safeLearningContent) : null);
      setClauses.push(`learning_content = $${paramIndex}::jsonb`);
      paramIndex++;
    }

    for (const field of numericFields) {
      if (req.body[field] !== undefined) {
        params.push(req.body[field]);
        setClauses.push(`${field} = $${paramIndex}`);
        paramIndex++;
      }
    }

    for (const field of boolFields) {
      if (req.body[field] !== undefined) {
        params.push(req.body[field]);
        setClauses.push(`${field} = $${paramIndex}`);
        paramIndex++;
      }
    }

    params.push(assignmentId);
    const query = `UPDATE assignments SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`;

    const result = await pool.query(query, params);

    // Fire-and-forget: (re)build the Transcribe custom vocabulary for voice input.
    syncVocabulary(Number(assignmentId));

    // Include a pending-review session count so the frontend can offer a
    // "regrade pending drafts with the current rubric" action after the save.
    const pendingResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM simulation_sessions
       WHERE assignment_id = $1 AND status = 'completed' AND review_status = 'pending_review'`,
      [assignmentId]
    );

    res.json({
      assignment: result.rows[0],
      pending_review_count: pendingResult.rows[0].count,
      rubric_changed: req.body.rubric !== undefined,
    });
  } catch (error) {
    console.error('Error updating assignment:', error);
    res.status(500).json({ error: 'Failed to update assignment' });
  }
});

// Promote a completed session into rubric exemplars
router.post('/assignments/:assignmentId/exemplars-from-session', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { session_id, promotions } = req.body;
    const contextId = getContextId(req.ltiToken);

    if (!session_id || !Array.isArray(promotions) || promotions.length === 0) {
      return res.status(400).json({ error: 'session_id and non-empty promotions array are required' });
    }

    const assignmentResult = await pool.query(
      'SELECT * FROM assignments WHERE id = $1 AND lti_context_id = $2 AND platform_id = $3',
      [assignmentId, contextId, req.platformId]
    );
    if (assignmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    const assignment = assignmentResult.rows[0];

    const sessionCheck = await pool.query(
      'SELECT id, status FROM simulation_sessions WHERE id = $1 AND assignment_id = $2',
      [session_id, assignmentId]
    );
    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found for this assignment' });
    }
    if (sessionCheck.rows[0].status !== 'completed') {
      return res.status(400).json({ error: 'Only completed sessions can be promoted to exemplars' });
    }

    const interactions = await pool.query(
      `SELECT role, content FROM simulation_interactions WHERE session_id = $1 ORDER BY timestamp ASC`,
      [session_id]
    );
    const transcript = interactions.rows
      .map((m) => `${m.role === 'user' ? 'Student' : 'AI'}: ${m.content}`)
      .join('\n\n');
    if (!transcript.trim()) {
      return res.status(400).json({ error: 'Session has no transcript to promote' });
    }

    const rubric = Array.isArray(assignment.rubric) ? assignment.rubric : [];
    const scoringEnabled = assignment.scoring_enabled !== false;

    const updatedRubric = rubric.map((criterion) => ({ ...criterion, exemplars: Array.isArray(criterion.exemplars) ? [...criterion.exemplars] : [] }));

    const added = [];
    for (const promo of promotions) {
      const idx = updatedRubric.findIndex((c) => c.id === promo.criterion_id);
      if (idx === -1) {
        return res.status(400).json({ error: `Criterion ${promo.criterion_id} not found in rubric` });
      }
      if (updatedRubric[idx].exemplars.length >= MAX_EXEMPLARS_PER_CRITERION) {
        return res.status(400).json({ error: `Criterion "${updatedRubric[idx].name}" already has ${MAX_EXEMPLARS_PER_CRITERION} exemplars` });
      }
      updatedRubric[idx].exemplars.push({
        id: `exemplar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        label: typeof promo.label === 'string' ? promo.label.slice(0, 100) : '',
        score: scoringEnabled && promo.score != null && !Number.isNaN(Number(promo.score)) ? Number(promo.score) : null,
        excerpt: transcript.slice(0, MAX_EXEMPLAR_EXCERPT_CHARS),
        explanation: typeof promo.explanation === 'string' ? promo.explanation.slice(0, MAX_EXEMPLAR_EXPLANATION_CHARS) : '',
        source_session_id: Number(session_id),
        created_at: new Date().toISOString(),
      });
      added.push(promo.criterion_id);
    }

    const sanitized = sanitizeRubricExemplars(updatedRubric, scoringEnabled);

    const updateResult = await pool.query(
      `UPDATE assignments SET rubric = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING rubric`,
      [JSON.stringify(sanitized), assignmentId]
    );

    res.json({ rubric: updateResult.rows[0].rubric, added_count: added.length });
  } catch (error) {
    console.error('Error promoting session to exemplars:', error);
    res.status(500).json({ error: 'Failed to promote session to exemplars' });
  }
});

// Preview assignment AI config (instructor tests their persona)
router.post('/assignments/:assignmentId/preview', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { message, history } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const assignmentResult = await pool.query(
      'SELECT * FROM assignments WHERE id = $1 AND platform_id = $2',
      [assignmentId, req.platformId]
    );

    if (assignmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const quota = await checkAiQuota();
    if (!quota.allowed) {
      const detail = quota.reason === 'budget'
        ? `$${Number(quota.spendUsd).toFixed(2)} of $${Number(quota.budgetUsd).toFixed(2)} budget`
        : `${quota.used}/${quota.limit} calls`;
      return res.status(429).json({
        error: 'AI usage limit reached',
        message: `Your institution has reached its monthly AI usage limit (${detail}). Contact your LTISim administrator to raise it.`,
      });
    }

    const assignment = assignmentResult.rows[0];
    const systemPrompt = buildSystemPrompt(assignment);
    const chatOptions = getChatOptions(assignment);
    const provider = getProviderForAssignment(assignment);

    const messages = [...(history || []), { role: 'user', content: message }];

    // Streaming (opt-in with ?stream=1) — same SSE framing as the student
    // chat endpoint; authors iterating in Preview get the same live output.
    if (req.query.stream === '1') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      try {
        const result = await provider.chatStream({
          systemPrompt,
          messages,
          options: chatOptions,
          onDelta: (text) => send({ delta: text }),
        });
        logAiUsage({
          platform_id: req.platformId,
          assignment_id: assignment.id,
          model_id: result.metadata?.model,
          call_type: 'preview',
          usage: result.usage,
        });
        send({ done: true, content: result.content, usage: result.usage });
      } catch (error) {
        console.error('Error in streaming preview:', error);
        send({ error: 'Failed to generate preview response' });
      }
      return res.end();
    }

    const result = await provider.chat({
      systemPrompt,
      messages,
      options: chatOptions,
    });

    logAiUsage({
      platform_id: req.platformId,
      assignment_id: assignment.id,
      model_id: result.metadata?.model,
      call_type: 'preview',
      usage: result.usage,
    });

    res.json({
      content: result.content,
      usage: result.usage,
    });
  } catch (error) {
    console.error('Error in preview:', error);
    res.status(500).json({ error: 'Failed to generate preview response', details: error.message });
  }
});

// Delete an assignment
router.delete('/assignments/:assignmentId', verifyLTI, verifyInstructor, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { assignmentId } = req.params;
    const contextId = getContextId(req.ltiToken);

    const assignmentCheck = await client.query(
      'SELECT id, transcribe_vocab FROM assignments WHERE id = $1 AND lti_context_id = $2 AND platform_id = $3',
      [assignmentId, contextId, req.platformId]
    );

    if (assignmentCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Assignment not found or does not belong to this course' });
    }

    const sessionsResult = await client.query(
      'DELETE FROM simulation_sessions WHERE assignment_id = $1',
      [assignmentId]
    );

    await client.query('DELETE FROM assignments WHERE id = $1', [assignmentId]);

    await client.query('COMMIT');

    // Fire-and-forget: drop the assignment's Transcribe vocabulary on AWS.
    deleteVocabulary(Number(assignmentId), assignmentCheck.rows[0].transcribe_vocab);

    res.json({
      success: true,
      message: 'Assignment deleted successfully',
      sessionsDeleted: sessionsResult.rowCount
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting assignment:', error);
    res.status(500).json({ error: 'Failed to delete assignment' });
  } finally {
    client.release();
  }
});

// Release a pending-review session to the student
router.post('/sessions/:sessionId/release', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { score, score_breakdown, overall_feedback } = req.body;

    // Resolve the releasing instructor's user id
    const instructorResult = await pool.query(
      'SELECT id FROM users WHERE lti_user_id = $1 AND platform_id = $2',
      [req.ltiToken.user, req.platformId]
    );
    if (instructorResult.rows.length === 0) {
      return res.status(403).json({ error: 'Instructor user not found' });
    }

    const result = await releaseSessionById(sessionId, {
      platformId: req.platformId,
      releasedBy: instructorResult.rows[0].id,
      score,
      score_breakdown,
      overall_feedback,
    });

    res.json({ success: true, gradeSubmission: result.gradeSubmission });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error releasing session:', error);
    res.status(500).json({ error: 'Failed to release session' });
  }
});

// Retry grade passback for a completed, student-visible session. Resets the
// latest failed/queued submission to immediately-retryable (with a fresh
// attempt budget) and attempts it now; if no submission row exists, creates
// one from the session's recorded score. Never re-evaluates.
router.post('/sessions/:sessionId/retry-grade', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionResult = await pool.query(
      `SELECT s.id, s.score, s.review_status, s.lti_grade_context, a.max_score, a.scoring_enabled
       FROM simulation_sessions s
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.id = $1 AND a.platform_id = $2 AND s.status = 'completed'`,
      [sessionId, req.platformId]
    );
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const session = sessionResult.rows[0];
    if (session.review_status === 'pending_review') {
      return res.status(400).json({ error: 'Session is pending review — release it to send a grade' });
    }

    const scoringEnabled = session.scoring_enabled !== false;
    const scoreGiven = scoringEnabled ? Number(session.score) || 0 : 1;
    const scoreMaximum = scoringEnabled ? Number(session.max_score) || 100 : 1;

    const latest = await pool.query(
      'SELECT * FROM grade_submissions WHERE session_id = $1 ORDER BY id DESC LIMIT 1',
      [sessionId]
    );
    const row = latest.rows[0];

    if (row && ['failed', 'failed_permanent', 'pending_retry', 'retrying'].includes(row.status)) {
      // Legacy pre-v10 'failed' rows have no wire values — backfill from the session.
      const upd = await pool.query(
        `UPDATE grade_submissions
         SET status = 'pending_retry', attempt_count = 0, next_attempt_at = NOW(),
             score_given = COALESCE(score_given, $2), score_maximum = COALESCE(score_maximum, $3)
         WHERE id = $1 RETURNING *`,
        [row.id, scoreGiven, scoreMaximum]
      );
      const result = await attemptSubmissionRow(upd.rows[0]);
      return res.json({ success: result.success, error: result.error || null });
    }

    const result = await submitGradeForSession({
      sessionId,
      score: session.score,
      maxScore: session.max_score,
      scoringEnabled,
      ltiGradeContext: session.lti_grade_context,
    });
    res.json({ success: result.success, error: result.error || null, queued: result.queued || false });
  } catch (error) {
    console.error('Error retrying grade passback:', error);
    res.status(500).json({ error: 'Failed to retry grade passback' });
  }
});

// Save evaluation edits (works on any completed session)
// For pending_review sessions: saves edits only (no grade passback)
// For released/immediate sessions: saves edits + re-submits grade to Canvas with update comment
router.put('/sessions/:sessionId/evaluation', verifyLTI, verifyInstructor, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { sessionId } = req.params;
    const { score, score_breakdown, overall_feedback } = req.body;

    const sessionResult = await client.query(
      `SELECT s.*, a.platform_id, a.max_score, a.scoring_enabled
       FROM simulation_sessions s
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.id = $1 AND a.platform_id = $2`,
      [sessionId, req.platformId]
    );

    if (sessionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];

    if (session.status !== 'completed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Session is not completed' });
    }

    // Apply updates
    let finalScore = score !== undefined ? score : session.score;
    let finalScoreBreakdown = score_breakdown || session.score_breakdown;
    let finalAiEvaluation = session.ai_evaluation;

    if (overall_feedback !== undefined) {
      finalAiEvaluation = { ...finalAiEvaluation, overall_feedback };
    }

    // An instructor-authored evaluation also clears any evaluation-failure
    // state — manual grading is the escape hatch for failed AI evaluations,
    // and the release guard keys off evaluation_status.
    await client.query(
      `UPDATE simulation_sessions
       SET score = $1,
           score_breakdown = $2,
           ai_evaluation = $3,
           evaluation_status = NULL,
           evaluation_error = NULL,
           next_evaluation_at = NULL
       WHERE id = $4`,
      [finalScore, JSON.stringify(finalScoreBreakdown), JSON.stringify(finalAiEvaluation), sessionId]
    );

    await client.query('COMMIT');

    // If session is already visible to student (released or immediate mode),
    // re-submit grade to Canvas with an update notification comment.
    // Post-commit: failures (including a missing LTI context, which the old
    // code didn't even record) are queued for retry by grade-passback.js.
    const isStudentVisible = session.review_status === 'released' || session.review_status === null;
    let gradeSubmission = null;

    if (isStudentVisible) {
      const formattedDate = new Date().toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      gradeSubmission = await submitGradeForSession({
        sessionId,
        score: finalScore,
        maxScore: session.max_score,
        scoringEnabled: session.scoring_enabled !== false,
        comment: `Your score and/or feedback have been updated as of ${formattedDate}. Please review the latest feedback in the simulation app.`,
        ltiGradeContext: session.lti_grade_context,
      });
    }

    res.json({ success: true, gradeUpdated: isStudentVisible, gradeSubmission });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving evaluation:', error);
    res.status(500).json({ error: 'Failed to save evaluation' });
  } finally {
    client.release();
  }
});

// Regrade a single pending-review session with the current rubric
router.post('/sessions/:sessionId/regrade', verifyLTI, verifyInstructor, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await regradeSessionById(client, req.params.sessionId, req.platformId);
    await client.query('COMMIT');
    res.json(result);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error regrading session:', error);
    res.status(500).json({ error: 'Failed to regrade session' });
  } finally {
    client.release();
  }
});

// Blind grading (grading-agreement capture): the instructor grades the
// session per-criterion WITHOUT having seen the AI draft; the server records
// (human, AI) pairs in grading_agreement and only then returns the AI
// evaluation for the side-by-side reveal. Pending-review sessions only —
// once released, the instructor has seen the AI's scores, so it isn't blind.
router.post('/sessions/:sessionId/blind-grade', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { grades } = req.body;

    if (!Array.isArray(grades) || grades.length === 0) {
      return res.status(400).json({ error: 'grades must be a non-empty array of { criterion_id, score, level }' });
    }

    const sessionResult = await pool.query(
      `SELECT s.id, s.assignment_id, s.review_status, s.status, s.score_breakdown,
              a.rubric, a.platform_id, a.scoring_enabled
       FROM simulation_sessions s
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.id = $1 AND a.platform_id = $2`,
      [sessionId, req.platformId]
    );
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const session = sessionResult.rows[0];
    if (session.status !== 'completed' || session.review_status !== 'pending_review') {
      return res.status(400).json({ error: 'Blind grading is only available on pending-review sessions' });
    }
    const aiEvaluations = session.score_breakdown?.criteria_evaluations || [];
    if (aiEvaluations.length === 0) {
      return res.status(400).json({ error: 'This session has no AI evaluation to compare against yet' });
    }

    const rubricById = new Map((session.rubric || []).map((c) => [String(c.id), c]));
    const aiById = new Map(aiEvaluations.map((ev) => [String(ev.id), ev]));

    // Resolve the local instructor user row (same pattern as session feedback)
    const instructorResult = await pool.query(
      'SELECT id FROM users WHERE lti_user_id = $1 AND platform_id = $2',
      [req.ltiToken.user, req.platformId]
    );
    const instructorId = instructorResult.rows[0]?.id || null;

    const comparison = [];
    for (const g of grades) {
      const criterion = rubricById.get(String(g?.criterion_id));
      const aiEval = aiById.get(String(g?.criterion_id));
      if (!criterion || !aiEval) continue; // unknown or since-removed criterion

      const maxPoints = Number(criterion.max_points);
      let humanScore = g.score != null ? Number(g.score) : null;
      if (humanScore != null) {
        if (!Number.isFinite(humanScore)) humanScore = null;
        else humanScore = Math.min(Math.max(humanScore, 0), Number.isFinite(maxPoints) ? maxPoints : humanScore);
      }
      const humanLevel = typeof g.level === 'string' ? g.level.slice(0, 100) : null;

      await pool.query(
        `INSERT INTO grading_agreement
           (session_id, assignment_id, platform_id, criterion_id, criterion_name, max_points,
            human_score, human_level, ai_score, ai_level, ai_confidence, instructor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (session_id, criterion_id)
         DO UPDATE SET human_score = $7, human_level = $8, ai_score = $9, ai_level = $10,
                       ai_confidence = $11, instructor_id = $12, created_at = CURRENT_TIMESTAMP`,
        [
          sessionId, session.assignment_id, req.platformId,
          String(g.criterion_id), criterion.name || null,
          Number.isFinite(maxPoints) ? maxPoints : null,
          humanScore, humanLevel,
          Number.isFinite(Number(aiEval.score)) ? Number(aiEval.score) : null,
          aiEval.level_achieved || null,
          aiEval.confidence || null,
          instructorId,
        ]
      );

      comparison.push({
        criterion_id: String(g.criterion_id),
        name: criterion.name,
        max_points: Number.isFinite(maxPoints) ? maxPoints : null,
        human_score: humanScore,
        human_level: humanLevel,
        ai_score: Number.isFinite(Number(aiEval.score)) ? Number(aiEval.score) : null,
        ai_level: aiEval.level_achieved || null,
        ai_confidence: aiEval.confidence || null,
        ai_feedback: aiEval.feedback || '',
        level_match: !!(humanLevel && aiEval.level_achieved
          && humanLevel.trim().toLowerCase() === String(aiEval.level_achieved).trim().toLowerCase()),
      });
    }

    if (comparison.length === 0) {
      return res.status(400).json({ error: 'No grades matched the current rubric criteria' });
    }

    const scored = comparison.filter((c) => c.human_score != null && c.ai_score != null);
    const summary = {
      total: comparison.length,
      level_matches: comparison.filter((c) => c.level_match).length,
      score_mae: scored.length
        ? Number((scored.reduce((acc, c) => acc + Math.abs(c.human_score - c.ai_score), 0) / scored.length).toFixed(2))
        : null,
    };

    res.json({ ok: true, comparison, summary });
  } catch (error) {
    console.error('Error recording blind grade:', error);
    res.status(500).json({ error: 'Failed to record blind grade' });
  }
});

// Agreement stats for one assignment (instructor view): how often the AI's
// level matched the instructor's blind grade, and the average score gap.
router.get('/assignments/:assignmentId/agreement', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const contextId = getContextId(req.ltiToken);

    const check = await pool.query(
      'SELECT id FROM assignments WHERE id = $1 AND lti_context_id = $2 AND platform_id = $3',
      [assignmentId, contextId, req.platformId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const stats = await pool.query(
      `SELECT
         COUNT(*)::int AS pairs,
         COUNT(DISTINCT session_id)::int AS sessions,
         COUNT(*) FILTER (WHERE human_level IS NOT NULL AND ai_level IS NOT NULL
           AND LOWER(TRIM(human_level)) = LOWER(TRIM(ai_level)))::int AS level_matches,
         ROUND(AVG(ABS(human_score - ai_score))::numeric, 2) AS score_mae,
         ROUND(AVG(CASE WHEN max_points > 0 THEN ABS(human_score - ai_score) / max_points * 100 END)::numeric, 1) AS score_mae_pct
       FROM grading_agreement
       WHERE assignment_id = $1`,
      [assignmentId]
    );

    const byCriterion = await pool.query(
      `SELECT criterion_id, MAX(criterion_name) AS criterion_name,
         COUNT(*)::int AS pairs,
         COUNT(*) FILTER (WHERE human_level IS NOT NULL AND ai_level IS NOT NULL
           AND LOWER(TRIM(human_level)) = LOWER(TRIM(ai_level)))::int AS level_matches,
         ROUND(AVG(ABS(human_score - ai_score))::numeric, 2) AS score_mae
       FROM grading_agreement
       WHERE assignment_id = $1
       GROUP BY criterion_id
       ORDER BY MAX(criterion_name)`,
      [assignmentId]
    );

    res.json({ summary: stats.rows[0], by_criterion: byCriterion.rows });
  } catch (error) {
    console.error('Error fetching agreement stats:', error);
    res.status(500).json({ error: 'Failed to fetch agreement stats' });
  }
});

// Assignment analytics: criterion-level class insight aggregated over each
// student's LATEST completed attempt (so a heatmap cell reads "% of students
// currently at this level", not "% of attempts"). Includes unreleased drafts —
// this is instructor-only data and drafts are visible to instructors anyway.
router.get('/assignments/:assignmentId/analytics', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const contextId = getContextId(req.ltiToken);

    const check = await pool.query(
      'SELECT id, rubric, max_score, scoring_enabled FROM assignments WHERE id = $1 AND lti_context_id = $2 AND platform_id = $3',
      [assignmentId, contextId, req.platformId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    const assignment = check.rows[0];

    const latestCte = `
      WITH latest AS (
        SELECT DISTINCT ON (s.user_id) s.*
        FROM simulation_sessions s
        WHERE s.assignment_id = $1 AND s.status = 'completed' AND NOT s.is_practice
        ORDER BY s.user_id, s.completed_at DESC NULLS LAST
      )`;

    const [summaryResult, criteriaResult, distributionResult] = await Promise.all([
      pool.query(
        `${latestCte}
         SELECT
           (SELECT COUNT(*) FROM simulation_sessions WHERE assignment_id = $1 AND NOT is_practice)::int AS total_sessions,
           (SELECT COUNT(*) FROM simulation_sessions WHERE assignment_id = $1 AND status = 'in_progress' AND NOT is_practice)::int AS in_progress,
           COUNT(*)::int AS students_completed,
           ROUND(AVG(l.score)::numeric, 1) AS avg_score,
           MIN(l.score) AS min_score,
           MAX(l.score) AS max_score,
           ROUND(AVG((SELECT COUNT(*) FROM simulation_interactions i
                      WHERE i.session_id = l.id AND i.role = 'user'))::numeric, 1) AS avg_student_messages
         FROM latest l`,
        [assignmentId]
      ),
      pool.query(
        `${latestCte}
         SELECT ce->>'id' AS criterion_id,
                MAX(ce->>'name') AS name,
                COALESCE(NULLIF(TRIM(ce->>'level_achieved'), ''), '(none)') AS level,
                COUNT(*)::int AS count,
                ROUND(AVG((ce->>'score')::numeric), 2) AS avg_score
         FROM latest l,
              jsonb_array_elements(l.score_breakdown->'criteria_evaluations') ce
         GROUP BY ce->>'id', COALESCE(NULLIF(TRIM(ce->>'level_achieved'), ''), '(none)')`,
        [assignmentId]
      ),
      pool.query(
        `${latestCte}
         SELECT width_bucket(
                  LEAST(GREATEST(l.score / NULLIF($2::numeric, 0) * 100, 0), 99.999), 0, 100, 10
                )::int AS bucket,
                COUNT(*)::int AS count
         FROM latest l
         WHERE l.score IS NOT NULL
         GROUP BY 1 ORDER BY 1`,
        [assignmentId, assignment.max_score || 100]
      ),
    ]);

    // Assemble per-criterion stats in rubric order; criteria that only exist
    // in old breakdowns (removed from the rubric since) are appended after.
    const rubric = assignment.rubric || [];
    const byId = new Map();
    for (const row of criteriaResult.rows) {
      const entry = byId.get(row.criterion_id) || { criterion_id: row.criterion_id, name: row.name, n: 0, weighted: 0, levels: [] };
      entry.n += row.count;
      if (row.avg_score != null) entry.weighted += Number(row.avg_score) * row.count;
      entry.levels.push({ level: row.level, count: row.count });
      byId.set(row.criterion_id, entry);
    }
    const finish = (entry, rubricCriterion) => ({
      criterion_id: entry.criterion_id,
      name: rubricCriterion?.name || entry.name || entry.criterion_id,
      max_points: rubricCriterion?.max_points ?? null,
      level_labels: (rubricCriterion?.levels || []).map((lv) => lv.label),
      n: entry.n,
      avg_score: entry.n > 0 && entry.weighted > 0 ? Number((entry.weighted / entry.n).toFixed(2)) : null,
      levels: entry.levels,
    });
    const criteria = [];
    for (const rc of rubric) {
      const entry = byId.get(String(rc.id));
      criteria.push(finish(entry || { criterion_id: String(rc.id), name: rc.name, n: 0, weighted: 0, levels: [] }, rc));
      byId.delete(String(rc.id));
    }
    for (const entry of byId.values()) criteria.push(finish(entry, null));

    res.json({
      summary: summaryResult.rows[0],
      criteria,
      distribution: distributionResult.rows,
      scoring_enabled: assignment.scoring_enabled !== false,
      max_score: assignment.max_score || 100,
    });
  } catch (error) {
    console.error('Error fetching assignment analytics:', error);
    res.status(500).json({ error: 'Failed to fetch assignment analytics' });
  }
});

// CSV export: one row per (student, attempt) with total + per-criterion
// score/level, columns in current rubric order. Streams as a download.
router.get('/assignments/:assignmentId/export.csv', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const contextId = getContextId(req.ltiToken);

    const check = await pool.query(
      'SELECT id, title, rubric, max_score, scoring_enabled FROM assignments WHERE id = $1 AND lti_context_id = $2 AND platform_id = $3',
      [assignmentId, contextId, req.platformId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    const assignment = check.rows[0];
    const rubric = assignment.rubric || [];

    const sessions = await pool.query(
      `SELECT s.id, s.status, s.review_status, s.evaluation_status, s.score,
              s.started_at, s.completed_at, s.score_breakdown,
              u.name AS student_name, u.email AS student_email,
              ROW_NUMBER() OVER (PARTITION BY s.user_id ORDER BY s.started_at ASC) AS attempt,
              (SELECT COUNT(*) FROM simulation_interactions i
               WHERE i.session_id = s.id AND i.role = 'user')::int AS student_messages
       FROM simulation_sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.assignment_id = $1 AND NOT s.is_practice
       ORDER BY u.name ASC, s.started_at ASC`,
      [assignmentId]
    );

    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const str = String(v);
      return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const iso = (d) => (d ? new Date(d).toISOString() : '');

    const header = [
      'Student', 'Email', 'Attempt', 'Status', 'Review status', 'Started', 'Completed',
      'Student messages', 'Score', 'Max score',
      ...rubric.flatMap((c) => [`${c.name} score`, `${c.name} max`, `${c.name} level`]),
    ];
    const lines = [header.map(esc).join(',')];

    for (const row of sessions.rows) {
      const evals = new Map(
        (row.score_breakdown?.criteria_evaluations || []).map((ce) => [String(ce.id), ce])
      );
      const status = row.evaluation_status
        ? `evaluation ${row.evaluation_status}`
        : row.status;
      const line = [
        row.student_name, row.student_email, row.attempt, status,
        row.review_status || (row.status === 'completed' ? 'released' : ''),
        iso(row.started_at), iso(row.completed_at), row.student_messages,
        row.score ?? '', assignment.max_score || 100,
        ...rubric.flatMap((c) => {
          const ce = evals.get(String(c.id));
          return [ce?.score ?? '', c.max_points ?? '', ce?.level_achieved ?? ''];
        }),
      ];
      lines.push(line.map(esc).join(','));
    }

    const safeTitle = String(assignment.title || 'assignment').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}-results.csv"`);
    res.send('\uFEFF' + lines.join('\r\n')); // BOM so Excel opens UTF-8 correctly
  } catch (error) {
    console.error('Error exporting assignment CSV:', error);
    res.status(500).json({ error: 'Failed to export assignment results' });
  }
});

// Regrade all pending-review sessions for an assignment with the current rubric
router.post('/assignments/:assignmentId/regrade-pending', verifyLTI, verifyInstructor, async (req, res) => {
  const { assignmentId } = req.params;
  const contextId = getContextId(req.ltiToken);

  // Verify assignment belongs to this instructor
  const check = await pool.query(
    'SELECT id FROM assignments WHERE id = $1 AND lti_context_id = $2 AND platform_id = $3',
    [assignmentId, contextId, req.platformId]
  );
  if (check.rows.length === 0) {
    return res.status(404).json({ error: 'Assignment not found' });
  }

  const results = await regradePendingForAssignment(assignmentId, req.platformId);
  res.json(results);
});

// Release all pending-review sessions for an assignment. Per-session
// failures don't abort the batch; passback outcomes are tallied.
router.post('/assignments/:assignmentId/release-pending', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const contextId = getContextId(req.ltiToken);

    const check = await pool.query(
      'SELECT id FROM assignments WHERE id = $1 AND lti_context_id = $2 AND platform_id = $3',
      [assignmentId, contextId, req.platformId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const instructorResult = await pool.query(
      'SELECT id FROM users WHERE lti_user_id = $1 AND platform_id = $2',
      [req.ltiToken.user, req.platformId]
    );
    if (instructorResult.rows.length === 0) {
      return res.status(403).json({ error: 'Instructor user not found' });
    }
    const instructorId = instructorResult.rows[0].id;

    const pending = await pool.query(
      `SELECT id FROM simulation_sessions
       WHERE assignment_id = $1 AND status = 'completed' AND review_status = 'pending_review'
       ORDER BY id ASC`,
      [assignmentId]
    );

    const results = { total: pending.rows.length, succeeded: 0, failed: 0, errors: [], passback: { submitted: 0, queued: 0 } };
    for (const row of pending.rows) {
      try {
        const r = await releaseSessionById(row.id, { platformId: req.platformId, releasedBy: instructorId });
        results.succeeded += 1;
        if (r.gradeSubmission?.success) results.passback.submitted += 1;
        else if (r.gradeSubmission?.queued) results.passback.queued += 1;
      } catch (error) {
        results.failed += 1;
        results.errors.push({ session_id: row.id, message: error.message });
        console.error(`Bulk release failed for session ${row.id}:`, error.message);
      }
    }

    res.json(results);
  } catch (error) {
    console.error('Error bulk-releasing sessions:', error);
    res.status(500).json({ error: 'Failed to release pending sessions' });
  }
});

// Deep link completion - returns HTML form that auto-submits to Canvas
router.get('/deep-link/complete', verifyLTI, verifyInstructor, async (req, res) => {
  try {
    const { assignmentId } = req.query;
    const ltik = req.query.ltik || req.headers['x-lti-token'];

    if (!assignmentId) {
      return res.status(400).send('Missing assignmentId');
    }

    // Retrieve stored deep linking token
    const storedToken = await getDeepLinkToken(ltik);
    if (!storedToken) {
      return res.status(400).send('Deep linking session expired. Please try again from Canvas.');
    }

    // Verify assignment exists and belongs to this instructor's course
    const contextId = getContextId(req.ltiToken);
    const assignmentResult = await pool.query(
      'SELECT id, title, max_score, scoring_enabled FROM assignments WHERE id = $1 AND lti_context_id = $2 AND platform_id = $3 AND is_published = true',
      [assignmentId, contextId, req.platformId]
    );

    if (assignmentResult.rows.length === 0) {
      return res.status(404).send('Assignment not found or not published.');
    }

    const assignment = assignmentResult.rows[0];
    const scoreMaximum = assignment.scoring_enabled
      ? Number(assignment.max_score) || 100
      : 1;

    // Build LTI resource link with a lineItem so Canvas provisions a gradebook column
    const resource = {
      type: 'ltiResourceLink',
      title: assignment.title,
      custom: {
        assignment_id: assignment.id.toString()
      },
      lineItem: {
        scoreMaximum,
        label: assignment.title,
        resourceId: `ltisim-${assignment.id}`,
        tag: 'ltisim'
      }
    };

    // Generate auto-submitting form for Canvas
    const form = await lti.DeepLinking.createDeepLinkingForm(storedToken, [resource], {
      message: `Assignment "${assignment.title}" linked successfully`
    });

    // Clean up stored token
    await removeDeepLinkToken(ltik);

    return res.send(form);
  } catch (error) {
    console.error('Deep link completion error:', error);
    return res.status(500).send('Failed to complete deep linking. Please try again.');
  }
});

module.exports = router;
