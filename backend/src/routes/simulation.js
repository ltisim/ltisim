const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const lti = require('ltijs').Provider;
const { getProviderForAssignment, buildSystemPrompt, getChatOptions, checkCompletionConditions } = require('../services/ai/index');
const { evaluateSession, resolveReviewStatus } = require('../services/ai/scoring');
const { verifyLTI, getContextId, verifySessionAccess } = require('../middleware/auth');
const { getLtiIdToken } = require('../utils/lti-grade');
const { submitGradeForSession } = require('../utils/grade-passback');
const { logAiUsage } = require('../utils/ai-usage');
const { checkAiQuota } = require('../utils/ai-quota');

// Get or create user from LTI token
router.get('/user', verifyLTI, async (req, res) => {
  try {
    const token = req.ltiToken;
    const ltiUserId = token.user;

    // Check if user exists (platform-scoped)
    let result = await pool.query(
      'SELECT * FROM users WHERE lti_user_id = $1 AND platform_id = $2',
      [ltiUserId, req.platformId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        ...result.rows[0],
        is_instructor: req.launch.is_instructor,
        is_instance_admin: req.launch.is_instance_admin,
        has_course: req.launch.course_id != null,
      },
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user information' });
  }
});

// Get all assignments for the student's course
router.get('/assignments', verifyLTI, async (req, res) => {
  try {
    const token = req.ltiToken;
    const contextId = getContextId(token);

    const courseResult = await pool.query(
      'SELECT name FROM courses WHERE lti_context_id = $1 AND platform_id = $2',
      [contextId, req.platformId]
    );
    const courseName = courseResult.rows[0]?.name || null;

    const result = await pool.query(
      `SELECT id, title, description, max_sessions, created_at, assignment_type, allow_practice
       FROM assignments
       WHERE lti_context_id = $1 AND platform_id = $2 AND is_published = TRUE
       ORDER BY created_at DESC`,
      [contextId, req.platformId]
    );

    res.json({ assignments: result.rows, courseName });
  } catch (error) {
    console.error('Error fetching assignments:', error);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

// Get current student's sessions
router.get('/my-sessions', verifyLTI, async (req, res) => {
  try {
    const token = req.ltiToken;
    const ltiUserId = token.user;

    const userResult = await pool.query(
      'SELECT id FROM users WHERE lti_user_id = $1 AND platform_id = $2',
      [ltiUserId, req.platformId]
    );

    if (userResult.rows.length === 0) {
      return res.json({ sessions: [] });
    }

    const userId = userResult.rows[0].id;

    const result = await pool.query(
      `SELECT s.id, s.assignment_id, s.status, s.score, s.started_at, s.completed_at,
              s.ai_evaluation, s.review_status, s.is_practice, s.score_breakdown,
              a.title as assignment_title, a.scoring_enabled, a.max_sessions,
              a.feedback_release_mode
       FROM simulation_sessions s
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.user_id = $1
       ORDER BY s.started_at DESC`,
      [userId]
    );

    res.json({ sessions: result.rows });
  } catch (error) {
    console.error('Error fetching student sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Get student-safe assignment details
router.get('/assignments/:assignmentId', verifyLTI, async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const result = await pool.query(
      `SELECT id, title, description, welcome_message, rubric, max_score, scoring_enabled, persona_name, feedback_release_mode, completion_conditions, assignment_type, learning_content, stages, artifact_config, examiner_config, voice_config
       FROM assignments WHERE id = $1 AND platform_id = $2`,
      [assignmentId, req.platformId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    // Return only student-visible fields; strip criteria to id, title, description
    const assignment = result.rows[0];
    const criteria = (assignment.rubric || []).map((c) => ({
      id: c.id,
      title: c.name,
      description: c.description || '',
      max_points: c.max_points || 0,
    }));

    res.json({
      assignment: {
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        welcome_message: assignment.welcome_message,
        criteria,
        scoring_enabled: assignment.scoring_enabled !== false,
        max_score: assignment.max_score,
        persona_name: assignment.persona_name || null,
        assignment_type: assignment.assignment_type || 'simulation',
        learning_content: assignment.learning_content || null,
        feedback_release_mode: assignment.feedback_release_mode || 'immediate',
        // Stage scenes are persona-side backstory — students see titles only
        stages: Array.isArray(assignment.stages)
          ? assignment.stages.map((st) => ({ id: st.id, title: st.title, min_messages: st.min_messages || 1, persona_name: st.persona_name || null }))
          : null,
        artifact_config: assignment.artifact_config || null,
        // Examiner guidance is examiner-side backstory — students see topics only
        examiner_areas: Array.isArray(assignment.examiner_config?.question_areas)
          ? assignment.examiner_config.question_areas.map((a) => ({ id: a.id, topic: a.topic, required: a.required !== false }))
          : null,
        examiner_style: assignment.examiner_config?.style || null,
        voice_config: assignment.voice_config || null,
        completion_conditions: {
          min_messages: assignment.completion_conditions?.min_messages || null,
          max_messages: assignment.completion_conditions?.max_messages || null,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching assignment:', error);
    res.status(500).json({ error: 'Failed to fetch assignment' });
  }
});

// Start a new simulation session
router.post('/session', verifyLTI, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const token = req.ltiToken;
    const { assignmentId: requestedAssignmentId, practice } = req.body;

    const ltiUserId = token.user;
    const contextId = getContextId(token);

    // Get user (platform-scoped)
    let userResult = await client.query(
      'SELECT id FROM users WHERE lti_user_id = $1 AND platform_id = $2',
      [ltiUserId, req.platformId]
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found - should have been created during LTI launch');
    }

    const userId = userResult.rows[0].id;

    // Get course from context (platform-scoped)
    const courseResult = await client.query(
      'SELECT id FROM courses WHERE lti_context_id = $1 AND platform_id = $2',
      [contextId, req.platformId]
    );

    if (courseResult.rows.length === 0) {
      throw new Error('Course not found - should have been created during LTI launch');
    }

    // Assignment ID is required
    if (!requestedAssignmentId) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Assignment ID is required to create a session',
        message: 'Please select an assignment from the dashboard'
      });
    }

    // Verify the assignment exists and belongs to this course and platform
    const assignmentCheck = await client.query(
      'SELECT id, title, lti_resource_link_id, welcome_message, max_sessions, allow_practice FROM assignments WHERE id = $1 AND lti_context_id = $2 AND platform_id = $3',
      [requestedAssignmentId, contextId, req.platformId]
    );

    if (assignmentCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Assignment not found or does not belong to this course'
      });
    }

    const assignmentId = requestedAssignmentId;
    const assignment = assignmentCheck.rows[0];

    // Check if there's already an in-progress session for this user and assignment
    const existingSessionResult = await client.query(
      `SELECT * FROM simulation_sessions
       WHERE user_id = $1 AND assignment_id = $2 AND status = 'in_progress'
       ORDER BY started_at DESC
       LIMIT 1`,
      [userId, assignmentId]
    );

    let sessionResult;
    let isNewSession = false;
    if (existingSessionResult.rows.length > 0) {
      // Resume whatever is in progress (practice or graded) — one in-progress
      // session per assignment at a time; its is_practice flag rides along.
      sessionResult = existingSessionResult;
    } else {
      const isPractice = practice === true;
      if (isPractice && assignment.allow_practice !== true) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Practice mode is not enabled for this assignment' });
      }

      // Enforce max_sessions limit — only completed GRADED sessions consume
      // attempts; practice sessions never do.
      if (!isPractice && assignment.max_sessions != null) {
        const countResult = await client.query(
          `SELECT COUNT(*) as session_count FROM simulation_sessions
           WHERE user_id = $1 AND assignment_id = $2 AND status = 'completed' AND NOT is_practice`,
          [userId, assignmentId]
        );
        const sessionsUsed = parseInt(countResult.rows[0].session_count, 10);
        if (sessionsUsed >= assignment.max_sessions) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Session limit reached',
            max_sessions: assignment.max_sessions,
            sessions_used: sessionsUsed,
          });
        }
      }

      isNewSession = true;
      sessionResult = await client.query(
        `INSERT INTO simulation_sessions (user_id, assignment_id, platform_id, status, data, is_practice)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [userId, assignmentId, req.platformId, 'in_progress', JSON.stringify({ started: new Date() }), isPractice]
      );
    }

    const session = sessionResult.rows[0];

    // If new session and assignment has a welcome message, insert it
    if (isNewSession && assignment.welcome_message) {
      await client.query(
        `INSERT INTO simulation_interactions (session_id, platform_id, role, content, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [session.id, req.platformId, 'assistant', assignment.welcome_message, JSON.stringify({ type: 'welcome' })]
      );
    }

    await client.query('COMMIT');

    res.json({ session });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create simulation session', details: error.message });
  } finally {
    client.release();
  }
});

// Get session by ID
router.get('/session/:sessionId', verifyLTI, verifySessionAccess, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const result = await pool.query(
      `SELECT s.*, u.name as user_name, a.title as assignment_title,
              a.feedback_release_mode, a.assignment_type
       FROM simulation_sessions s
       JOIN users u ON s.user_id = u.id
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.id = $1`,
      [sessionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ session: result.rows[0] });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// Add interaction to session (kept for backward compatibility)
router.post('/session/:sessionId/interaction', verifyLTI, verifySessionAccess, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { role, content, metadata } = req.body;

    if (!role || !content) {
      return res.status(400).json({ error: 'Role and content are required' });
    }

    const result = await pool.query(
      `INSERT INTO simulation_interactions (session_id, role, content, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [sessionId, role, content, JSON.stringify(metadata || {})]
    );

    res.json({ interaction: result.rows[0] });
  } catch (error) {
    console.error('Error adding interaction:', error);
    res.status(500).json({ error: 'Failed to add interaction' });
  }
});

// Chat endpoint - sends message and gets AI response
router.post('/session/:sessionId/chat', verifyLTI, verifySessionAccess, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // Validate session is in_progress
    const sessionResult = await pool.query(
      `SELECT s.*, a.system_prompt, a.persona_name, a.persona_description,
              a.scenario_context, a.ai_provider_config,
              a.completion_conditions, a.welcome_message, a.rubric, a.max_score,
              a.scoring_enabled, a.assignment_type, a.stages, a.examiner_config
       FROM simulation_sessions s
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.id = $1`,
      [sessionId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];

    if (session.status !== 'in_progress') {
      return res.status(400).json({ error: 'Session is not in progress' });
    }

    // Enforce message limit before saving or calling AI
    const countResult = await pool.query(
      `SELECT COUNT(*) as cnt FROM simulation_interactions
       WHERE session_id = $1 AND role = 'user'`,
      [sessionId]
    );
    const currentUserMessages = parseInt(countResult.rows[0].cnt, 10);
    const conditions = session.completion_conditions || {};
    const { ABSOLUTE_MAX_MESSAGES, PRACTICE_MAX_MESSAGES } = require('../services/ai');
    const hardCap = session.is_practice === true
      ? Math.min(PRACTICE_MAX_MESSAGES, ABSOLUTE_MAX_MESSAGES)
      : ABSOLUTE_MAX_MESSAGES;
    const effectiveMax = conditions.max_messages
      ? Math.min(conditions.max_messages, hardCap)
      : hardCap;

    if (currentUserMessages >= effectiveMax) {
      return res.status(400).json({
        error: 'Message limit reached',
        message: 'You have reached the maximum number of messages for this simulation. Please complete the simulation.',
        maxReached: true,
      });
    }

    // Enforce the instance's monthly AI limits before saving or calling AI.
    // Evaluation is exempt (see ai-quota.js) so in-flight work can finish.
    const quota = await checkAiQuota();
    if (!quota.allowed) {
      console.warn(`[ai-quota] over monthly AI ${quota.reason} limit (${quota.used}/${quota.limit})`);
      return res.status(429).json({
        error: 'AI usage limit reached',
        message: 'Your institution has reached its monthly AI usage limit. Please contact your instructor or administrator.',
      });
    }

    // Save user message (input_mode notes voice vs typed for later analytics)
    const inputMode = req.body.input_mode === 'voice' ? 'voice' : 'typed';
    const userInteractionResult = await pool.query(
      `INSERT INTO simulation_interactions (session_id, role, content, metadata)
       VALUES ($1, 'user', $2, $3)
       RETURNING *`,
      [sessionId, content, JSON.stringify({ input_mode: inputMode })]
    );

    // Fetch full conversation history
    const historyResult = await pool.query(
      `SELECT role, content FROM simulation_interactions
       WHERE session_id = $1
       ORDER BY timestamp ASC`,
      [sessionId]
    );

    // Build system prompt from assignment config (staged simulations layer
    // the current stage's scene on top; current_stage lives in session.data)
    session._current_stage = session.data?.current_stage || 0;
    session._covered_areas = session.data?.covered_areas || [];
    const systemPrompt = buildSystemPrompt(session);
    const chatOptions = getChatOptions(session);
    const provider = getProviderForAssignment(session);

    // ai_examiner: raw content (with [[area_done:id]] markers) is stored for
    // grading; markers are stripped from everything the student receives, and
    // coverage is recorded on the session. Returns the student-safe content
    // plus an examinerStatus payload for the completion gate.
    const { AREA_MARKER_RE } = require('../utils/assignment-extras');
    const isExaminer = session.assignment_type === 'ai_examiner' && session.examiner_config?.question_areas?.length > 0;
    const processExaminerReply = async (rawContent) => {
      const found = [...rawContent.matchAll(AREA_MARKER_RE)].map((m) => m[1]);
      const validIds = new Set(session.examiner_config.question_areas.map((a) => a.id));
      const newlyDone = found.filter((id) => validIds.has(id));
      const covered = [...new Set([...(session.data?.covered_areas || []), ...newlyDone])];
      if (newlyDone.length > 0) {
        await pool.query(
          `UPDATE simulation_sessions
           SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object('covered_areas', $1::jsonb)
           WHERE id = $2`,
          [JSON.stringify(covered), sessionId]
        );
      }
      const requiredRemaining = session.examiner_config.question_areas
        .filter((a) => a.required !== false && !covered.includes(a.id)).length;
      return {
        cleanContent: rawContent.replace(AREA_MARKER_RE, '').trimEnd(),
        examinerStatus: {
          covered,
          total: session.examiner_config.question_areas.length,
          required_remaining: requiredRemaining,
        },
      };
    };

    // Streaming (opt-in with ?stream=1): SSE-style frames over the POST
    // response — `{delta}` per text chunk, then `{done, userInteraction,
    // aiInteraction, completionStatus}`. All validation failures above still
    // return normal JSON status codes (headers aren't sent until here).
    // Non-streaming clients get the original JSON response unchanged.
    const wantsStream = req.query.stream === '1';

    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

      try {
        const aiResult = await provider.chatStream({
          systemPrompt,
          messages: historyResult.rows,
          options: chatOptions,
          // Examiner replies are short and may end in a coverage marker that
          // must not leak — buffer them instead of streaming token-by-token.
          onDelta: isExaminer ? undefined : (text) => send({ delta: text }),
        });

        logAiUsage({
          platform_id: req.platformId,
          assignment_id: session.assignment_id,
          session_id: sessionId,
          model_id: aiResult.metadata?.model,
          call_type: 'chat',
          usage: aiResult.usage,
        });

        let examinerStatus = null;
        let wireContent = aiResult.content;
        if (isExaminer) {
          const processed = await processExaminerReply(aiResult.content);
          wireContent = processed.cleanContent;
          examinerStatus = processed.examinerStatus;
          send({ delta: wireContent });
        }

        const aiInteractionResult = await pool.query(
          `INSERT INTO simulation_interactions (session_id, role, content, metadata)
           VALUES ($1, 'assistant', $2, $3)
           RETURNING *`,
          [sessionId, aiResult.content, JSON.stringify({ usage: aiResult.usage, metadata: aiResult.metadata })]
        );

        const completionStatus = checkCompletionConditions(session, historyResult.rows.length + 1);
        send({
          done: true,
          userInteraction: userInteractionResult.rows[0],
          aiInteraction: { ...aiInteractionResult.rows[0], content: wireContent },
          completionStatus,
          ...(examinerStatus && { examinerStatus }),
        });
      } catch (error) {
        console.error('Error in streaming chat:', error);
        send({ error: 'Failed to process chat message' });
      }
      return res.end();
    }

    // Call AI provider
    const aiResult = await provider.chat({
      systemPrompt,
      messages: historyResult.rows,
      options: chatOptions,
    });

    logAiUsage({
      platform_id: req.platformId,
      assignment_id: session.assignment_id,
      session_id: sessionId,
      model_id: aiResult.metadata?.model,
      call_type: 'chat',
      usage: aiResult.usage,
    });

    let examinerStatus = null;
    let wireContent = aiResult.content;
    if (isExaminer) {
      const processed = await processExaminerReply(aiResult.content);
      wireContent = processed.cleanContent;
      examinerStatus = processed.examinerStatus;
    }

    // Save AI response (raw, markers included — grading needs the boundaries)
    const aiInteractionResult = await pool.query(
      `INSERT INTO simulation_interactions (session_id, role, content, metadata)
       VALUES ($1, 'assistant', $2, $3)
       RETURNING *`,
      [sessionId, aiResult.content, JSON.stringify({ usage: aiResult.usage, metadata: aiResult.metadata })]
    );

    // Check completion conditions
    const totalInteractions = historyResult.rows.length + 1; // +1 for the AI response we just added
    const completionStatus = checkCompletionConditions(session, totalInteractions);

    res.json({
      userInteraction: userInteractionResult.rows[0],
      aiInteraction: { ...aiInteractionResult.rows[0], content: wireContent },
      completionStatus,
      ...(examinerStatus && { examinerStatus }),
    });
  } catch (error) {
    console.error('Error in chat:', error);
    res.status(500).json({ error: 'Failed to process chat message', details: error.message });
  }
});

// Evaluate and complete session
router.post('/session/:sessionId/evaluate-and-complete', verifyLTI, verifySessionAccess, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { sessionId } = req.params;

    // Get session + assignment config
    const sessionResult = await client.query(
      `SELECT s.*, a.rubric, a.max_score, a.scoring_enabled,
              a.ai_provider_config, a.system_prompt, a.persona_name,
              a.persona_description, a.scenario_context, a.completion_conditions,
              a.title, a.description, a.feedback_release_mode, a.assignment_type,
              a.stages, a.artifact_config, a.examiner_config
       FROM simulation_sessions s
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.id = $1
       FOR UPDATE OF s`,
      [sessionId]
    );

    if (sessionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];

    if (session.status !== 'in_progress') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Session is not in progress' });
    }

    // AI examiner: all required question areas must be covered — unless the
    // student hit the message cap (the escape hatch when marker detection or
    // the conversation itself stalls; the grader still scores what exists).
    if (session.assignment_type === 'ai_examiner' && session.examiner_config?.question_areas?.length > 0) {
      const covered = new Set(session.data?.covered_areas || []);
      const remaining = session.examiner_config.question_areas
        .filter((a) => a.required !== false && !covered.has(a.id));
      if (remaining.length > 0) {
        const capCount = await client.query(
          `SELECT COUNT(*)::int AS cnt FROM simulation_interactions WHERE session_id = $1 AND role = 'user'`,
          [sessionId]
        );
        const { ABSOLUTE_MAX_MESSAGES } = require('../services/ai');
        const conditions = session.completion_conditions || {};
        const cap = conditions.max_messages ? Math.min(conditions.max_messages, ABSOLUTE_MAX_MESSAGES) : ABSOLUTE_MAX_MESSAGES;
        if (capCount.rows[0].cnt < cap) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'Areas remaining',
            message: `The examiner still has ${remaining.length} topic${remaining.length === 1 ? '' : 's'} to cover. Keep going!`,
          });
        }
      }
    }

    // Staged simulations can only be completed from the final stage
    if (session.assignment_type === 'staged_simulation' && Array.isArray(session.stages) && session.stages.length > 0) {
      const currentStage = Number(session.data?.current_stage) || 0;
      if (currentStage < session.stages.length - 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Not in the final stage',
          message: `Work through all ${session.stages.length} stages before completing.`,
        });
      }
    }

    // Artifact assignments require the write-up at completion time; it is
    // stored on the session and graded together with the transcript.
    let artifactText = null;
    if (session.assignment_type === 'simulation_with_artifact' && session.artifact_config) {
      artifactText = typeof req.body?.artifact_text === 'string' ? req.body.artifact_text.trim() : '';
      const words = artifactText ? artifactText.split(/\s+/).length : 0;
      const minWords = session.artifact_config.min_words;
      if (!artifactText || (minWords && words < minWords)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Artifact required',
          message: minWords
            ? `Your ${session.artifact_config.title || 'write-up'} must be at least ${minWords} words (currently ${words}).`
            : `Please complete your ${session.artifact_config.title || 'write-up'} before submitting.`,
        });
      }
      if (words > 10000) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Artifact too long', message: 'Please keep the write-up under 10,000 words.' });
      }
      await client.query(
        'UPDATE simulation_sessions SET data = $1 WHERE id = $2',
        [JSON.stringify({ ...(session.data || {}), artifact: { text: artifactText, submitted_at: new Date().toISOString() } }), sessionId]
      );
    }

    // Get all interactions
    const interactionsResult = await client.query(
      `SELECT * FROM simulation_interactions
       WHERE session_id = $1
       ORDER BY timestamp ASC`,
      [sessionId]
    );

    const interactions = interactionsResult.rows;

    const scoringEnabled = session.scoring_enabled !== false;
    const feedbackReleaseMode = session.feedback_release_mode || 'immediate';

    // Capture LTI context for deferred grade passback
    let ltiIdToken = null;
    try {
      ltiIdToken = await getLtiIdToken(req.ltiToken);
    } catch (e) {
      console.warn('Could not capture LTI idtoken:', e.message);
    }

    // Evaluate (attach _session_id for AI usage logging inside scoring.js).
    // An evaluator failure must not block completion or fabricate a score:
    // the session completes with evaluation_status='pending_evaluation' and
    // the evaluation-retry worker re-runs it. No grade reaches the LMS until
    // a real evaluation exists.
    session._session_id = session.id;
    let evaluation = null;
    let evaluationError = null;
    try {
      evaluation = await evaluateSession(session, interactions, { artifactText });
    } catch (err) {
      evaluationError = err.message || 'AI evaluation failed';
      console.error(`[evaluation] session ${sessionId} evaluation failed at completion; queued for retry: ${evaluationError}`);
    }

    if (!evaluation) {
      // Practice sessions stay out of the instructor's review queue even on
      // evaluator failure — the retry worker will fill in the feedback.
      await client.query(
        `UPDATE simulation_sessions
         SET completed_at = CURRENT_TIMESTAMP,
             status = 'completed',
             completion_reason = 'user_completed',
             review_status = $4,
             evaluation_status = 'pending_evaluation',
             evaluation_attempts = 1,
             next_evaluation_at = NOW() + interval '1 minute',
             evaluation_error = $1,
             lti_grade_context = $2
         WHERE id = $3`,
        [
          evaluationError,
          ltiIdToken ? JSON.stringify(ltiIdToken) : null,
          sessionId,
          session.is_practice ? null : 'pending_review',
        ]
      );
      await client.query('COMMIT');

      const updatedSession = await pool.query(
        'SELECT * FROM simulation_sessions WHERE id = $1',
        [sessionId]
      );
      return res.json({
        session: updatedSession.rows[0],
        evaluation: null,
        gradeSubmission: { success: false, deferred: true },
        pendingReview: true,
        evaluationPending: true,
      });
    }

    // Determine persisted score: actual score when scored, 100 for scoreless (completion credit)
    const persistedScore = scoringEnabled ? (evaluation.score ?? 0) : 100;

    // Where this evaluation lands: immediate release, always-held
    // (instructor_review), or held only when the grader reported low
    // confidence on any criterion (confidence_gated). Practice sessions get
    // their feedback immediately regardless of mode — there is no grade to
    // protect, and no gradebook entry is ever made for them.
    const reviewStatus = session.is_practice
      ? null
      : resolveReviewStatus(feedbackReleaseMode, evaluation.criteria_evaluations);
    const isInstructorReview = reviewStatus === 'pending_review';

    // Update session
    await client.query(
      `UPDATE simulation_sessions
       SET completed_at = CURRENT_TIMESTAMP,
           score = $1,
           status = 'completed',
           score_breakdown = $2,
           ai_evaluation = $3,
           completion_reason = 'user_completed',
           review_status = $4,
           lti_grade_context = $5
       WHERE id = $6`,
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
        }),
        reviewStatus,
        ltiIdToken ? JSON.stringify(ltiIdToken) : null,
        sessionId,
      ]
    );

    await client.query('COMMIT');

    // Grade passback: immediate mode sends now (post-commit — a slow or
    // failing AGS call no longer holds the transaction; failures are queued
    // for retry by grade-passback.js). Instructor review defers until release.
    // Practice sessions never touch the gradebook.
    let gradeSubmission = { success: false };
    if (session.is_practice) {
      gradeSubmission = { success: false, practice: true };
    } else if (!isInstructorReview) {
      gradeSubmission = await submitGradeForSession({
        sessionId,
        score: persistedScore,
        maxScore: session.max_score,
        scoringEnabled,
        ltiGradeContext: ltiIdToken,
      });
    }

    // Fetch updated session
    const updatedSession = await pool.query(
      'SELECT * FROM simulation_sessions WHERE id = $1',
      [sessionId]
    );

    // For instructor review mode, hide evaluation from student
    if (isInstructorReview) {
      res.json({
        session: updatedSession.rows[0],
        evaluation: null,
        gradeSubmission: { success: false, deferred: true },
        pendingReview: true,
      });
    } else {
      res.json({
        session: updatedSession.rows[0],
        evaluation: {
          score: evaluation.score,
          criteria_evaluations: evaluation.criteria_evaluations,
          overall_feedback: evaluation.overall_feedback,
          fallback: evaluation.fallback || false,
          scoring_enabled: scoringEnabled,
        },
        gradeSubmission,
      });
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error evaluating session:', error);
    res.status(500).json({ error: 'Failed to evaluate and complete session', details: error.message });
  } finally {
    client.release();
  }
});

// Get all interactions for a session
router.get('/session/:sessionId/interactions', verifyLTI, verifySessionAccess, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const result = await pool.query(
      `SELECT * FROM simulation_interactions
       WHERE session_id = $1
       ORDER BY timestamp ASC`,
      [sessionId]
    );

    res.json({ interactions: result.rows });
  } catch (error) {
    console.error('Error fetching interactions:', error);
    res.status(500).json({ error: 'Failed to fetch interactions' });
  }
});

// Advance a staged simulation to its next stage. Server-authoritative: checks
// the per-stage minimum, bumps data.current_stage, and inserts a visible
// stage-divider row that both the chat model and the grader key off.
router.post('/session/:sessionId/advance-stage', verifyLTI, verifySessionAccess, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { sessionId } = req.params;

    const result = await client.query(
      `SELECT s.*, a.stages, a.assignment_type
       FROM simulation_sessions s
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.id = $1
       FOR UPDATE OF s`,
      [sessionId]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Session not found' });
    }
    const session = result.rows[0];
    if (session.status !== 'in_progress') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Session is not in progress' });
    }
    if (session.assignment_type !== 'staged_simulation' || !Array.isArray(session.stages) || session.stages.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This assignment has no stages' });
    }

    const current = Math.min(Number(session.data?.current_stage) || 0, session.stages.length - 1);
    if (current >= session.stages.length - 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Already in the final stage' });
    }

    // Per-stage minimum: student messages since the last divider (or start)
    const countResult = await client.query(
      `SELECT COUNT(*) FILTER (WHERE role = 'user' AND id > COALESCE(
         (SELECT MAX(id) FROM simulation_interactions
          WHERE session_id = $1 AND metadata->>'type' = 'stage_divider'), 0
       ))::int AS stage_user_messages
       FROM simulation_interactions WHERE session_id = $1`,
      [sessionId]
    );
    const stageUserMessages = countResult.rows[0].stage_user_messages;
    const required = session.stages[current].min_messages || 1;
    if (stageUserMessages < required) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Stage minimum not met',
        message: `Send at least ${required} message${required === 1 ? '' : 's'} in this stage first (${stageUserMessages} so far).`,
      });
    }

    const nextIndex = current + 1;
    const nextStage = session.stages[nextIndex];
    const { stageDividerText } = require('../utils/assignment-extras');

    await client.query(
      'UPDATE simulation_sessions SET data = $1 WHERE id = $2',
      [JSON.stringify({ ...(session.data || {}), current_stage: nextIndex }), sessionId]
    );
    const dividerResult = await client.query(
      `INSERT INTO simulation_interactions (session_id, platform_id, role, content, metadata)
       VALUES ($1, $2, 'assistant', $3, $4)
       RETURNING *`,
      [
        sessionId,
        req.platformId,
        stageDividerText(nextIndex, nextStage),
        JSON.stringify({ type: 'stage_divider', stage_index: nextIndex, stage_id: nextStage.id }),
      ]
    );
    await client.query('COMMIT');

    res.json({
      current_stage: nextIndex,
      stage: { id: nextStage.id, title: nextStage.title, min_messages: nextStage.min_messages || 1, persona_name: nextStage.persona_name || null },
      divider: dividerResult.rows[0],
      is_final_stage: nextIndex === session.stages.length - 1,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error advancing stage:', error);
    res.status(500).json({ error: 'Failed to advance stage' });
  } finally {
    client.release();
  }
});

// Autosave the artifact draft (simulation_with_artifact). A browser crash
// during a long write-up must not lose work; the final text is validated and
// frozen at evaluate-and-complete.
router.patch('/session/:sessionId/artifact-draft', verifyLTI, verifySessionAccess, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { text } = req.body || {};
    if (typeof text !== 'string' || text.length > 100000) {
      return res.status(400).json({ error: 'Invalid draft' });
    }
    const result = await pool.query(
      `UPDATE simulation_sessions
       SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object('artifact_draft', $1::text)
       WHERE id = $2 AND status = 'in_progress'
       RETURNING id`,
      [text, sessionId]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Session is not in progress' });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('Error saving artifact draft:', error);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

// Text-to-speech for an assistant reply (voice mode). Synthesizes the stored
// interaction's content (never arbitrary text) with the assignment's Polly
// voice. Fail-safe: 503 when Polly is unavailable (missing IAM permission) —
// the frontend falls back to text-only.
router.post('/session/:sessionId/tts', verifyLTI, verifySessionAccess, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { interactionId } = req.body || {};
    if (!interactionId) return res.status(400).json({ error: 'interactionId required' });

    const result = await pool.query(
      `SELECT i.content, a.voice_config
       FROM simulation_interactions i
       JOIN simulation_sessions s ON i.session_id = s.id
       JOIN assignments a ON s.assignment_id = a.id
       WHERE i.id = $1 AND i.session_id = $2 AND i.role = 'assistant'`,
      [interactionId, sessionId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Interaction not found' });
    if (result.rows[0].voice_config?.enabled !== true) {
      return res.status(400).json({ error: 'Voice is not enabled for this assignment' });
    }

    const { synthesize, isTtsAvailable } = require('../services/tts');
    if (!isTtsAvailable()) return res.status(503).json({ error: 'Voice output unavailable' });

    const { AREA_MARKER_RE: MARKER } = require('../utils/assignment-extras');
    const text = result.rows[0].content.replace(MARKER, '').slice(0, 3000);
    const audio = await synthesize(text, result.rows[0].voice_config.voice_id);
    if (!audio) return res.status(503).json({ error: 'Voice output unavailable' });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(audio);
  } catch (error) {
    console.error('Error in TTS:', error);
    res.status(500).json({ error: 'Failed to synthesize speech' });
  }
});

// Complete a session (legacy - kept for backward compatibility)
router.post('/session/:sessionId/complete', verifyLTI, verifySessionAccess, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { score } = req.body;

    const result = await pool.query(
      `UPDATE simulation_sessions
       SET completed_at = CURRENT_TIMESTAMP, score = $1, status = 'completed'
       WHERE id = $2
       RETURNING *`,
      [score, sessionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ session: result.rows[0] });
  } catch (error) {
    console.error('Error completing session:', error);
    res.status(500).json({ error: 'Failed to complete session' });
  }
});

module.exports = router;
