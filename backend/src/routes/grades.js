const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const lti = require('ltijs').Provider;
const { verifyLTI, verifySessionAccess } = require('../middleware/auth');

// Submit grade to Canvas
router.post('/submit', verifyLTI, async (req, res) => {
  const client = await pool.connect();

  try {
    const { sessionId, score } = req.body;

    if (!sessionId || score === undefined) {
      return res.status(400).json({ error: 'Session ID and score are required' });
    }

    // Validate score (0-100)
    if (score < 0 || score > 100) {
      return res.status(400).json({ error: 'Score must be between 0 and 100' });
    }

    await client.query('BEGIN');

    // Get session details (platform-scoped)
    const sessionResult = await client.query(
      `SELECT s.* FROM simulation_sessions s
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.id = $1 AND a.platform_id = $2`,
      [sessionId, req.platformId]
    );

    if (sessionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];

    // Create grade submission record
    const gradeResult = await client.query(
      `INSERT INTO grade_submissions (session_id, score, status)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [sessionId, score, 'pending']
    );

    const gradeSubmission = gradeResult.rows[0];

    try {
      // Submit grade via LTI
      const token = req.ltiToken;

      // Create grade object
      const grade = {
        scoreGiven: score,
        scoreMaximum: 100,
        activityProgress: 'Completed',
        gradingProgress: 'FullyGraded'
      };

      // Submit grade using ltijs
      const result = await lti.Grade.submitScore(token, grade);

      console.log('Grade submitted successfully:', result);

      // Update grade submission status
      await client.query(
        `UPDATE grade_submissions
         SET status = $1
         WHERE id = $2`,
        ['submitted', gradeSubmission.id]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        gradeSubmission: {
          ...gradeSubmission,
          status: 'submitted'
        },
        message: 'Grade submitted successfully'
      });

    } catch (gradeError) {
      console.error('Error submitting grade to Canvas:', gradeError);

      // Update grade submission with error
      await client.query(
        `UPDATE grade_submissions
         SET status = $1, error_message = $2
         WHERE id = $3`,
        ['failed', gradeError.message, gradeSubmission.id]
      );

      await client.query('COMMIT');

      res.status(500).json({
        error: 'Failed to submit grade to Canvas',
        details: gradeError.message,
        gradeSubmission: {
          ...gradeSubmission,
          status: 'failed',
          error_message: gradeError.message
        }
      });
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in grade submission:', error);
    res.status(500).json({ error: 'Failed to process grade submission' });
  } finally {
    client.release();
  }
});

// Get grade submissions for a session
router.get('/session/:sessionId', verifyLTI, verifySessionAccess, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const result = await pool.query(
      'SELECT * FROM grade_submissions WHERE session_id = $1 ORDER BY submitted_at DESC',
      [sessionId]
    );

    res.json({ submissions: result.rows });
  } catch (error) {
    console.error('Error fetching grade submissions:', error);
    res.status(500).json({ error: 'Failed to fetch grade submissions' });
  }
});

module.exports = router;
