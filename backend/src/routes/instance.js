// Instance administration, reached from inside the LMS.
//
// Every route requires a launch by an administrator of the LMS this instance
// serves (see utils/roles.js). There is no separate login: the LMS launch is
// the authentication.
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { verifyLTI, verifyInstanceAdmin } = require('../middleware/auth');
const { logAuditEvent } = require('../utils/audit-log');
const platforms = require('../services/platforms');
const aiModels = require('../services/ai/models');
const { clearPriceCache } = require('../utils/ai-usage');
const { getProvider } = require('../services/ai/index');
const { isEmailConfigured } = require('../services/email');
const { version } = require('../../package.json');

router.use(verifyLTI, verifyInstanceAdmin);

const audit = (req, fields) =>
  logAuditEvent({ actor_type: 'instance_admin', actor_id: req.launch.user_id, req, ...fields });

// null / '' clears a limit; otherwise a non-negative number.
function parseLimit(value, { integer }) {
  if (value === null || value === '' || value === undefined) return { value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) return { error: true };
  return { value: n };
}

const validDate = (v) => !v || !Number.isNaN(Date.parse(v));

async function monthToDate() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS calls,
            COALESCE(SUM(total_tokens), 0)::bigint AS tokens,
            COALESCE(SUM(cost_usd), 0) AS cost_usd,
            COUNT(*) FILTER (WHERE cost_usd IS NULL)::int AS unpriced_calls
       FROM ai_usage
      WHERE created_at >= date_trunc('month', CURRENT_TIMESTAMP)`
  );
  return rows[0];
}

async function getSettings() {
  const { rows } = await pool.query(
    `SELECT monthly_ai_call_limit, monthly_ai_budget_usd, alert_email,
            default_model, default_grading_model, updated_at
       FROM instance_settings`
  );
  return rows[0] || { monthly_ai_call_limit: null, monthly_ai_budget_usd: null, alert_email: null };
}

// --------------------------------------------------------------------------
// Overview: LMS connection, AI provider, limits and this month's usage
// --------------------------------------------------------------------------
router.get('/overview', async (req, res) => {
  try {
    const platform = await platforms.activePlatform();
    const counts = await pool.query(
      `SELECT (SELECT COUNT(*)::int FROM courses) AS courses,
              (SELECT COUNT(*)::int FROM assignments) AS assignments,
              (SELECT COUNT(*)::int FROM simulation_sessions) AS sessions,
              (SELECT COUNT(*)::int FROM users) AS users`
    );
    const ai = await aiModels.describe();
    res.json({
      lms: platform && {
        name: platform.display_name,
        issuer: platform.url,
        client_id: platform.client_id,
        status: platform.registration_status,
        registered_at: platform.registered_at,
        first_launch_at: platform.first_launch_at,
      },
      tool: platforms.toolConfig(),
      ai: {
        provider: ai.provider,
        provider_name: ai.provider_name,
        default_model: ai.default_model,
        default_grading_model: ai.default_grading_model,
      },
      settings: await getSettings(),
      month_to_date: await monthToDate(),
      counts: counts.rows[0],
      version,
      checks: {
        public_url: platforms.publicUrl(),
        public_url_https: platforms.publicUrl().startsWith('https://'),
        lms_registered: !!platform,
        lms_verified: platform?.registration_status === 'verified',
        default_model_set: !!ai.default_model,
        models_listed: ai.models.length,
        email_configured: isEmailConfigured(),
      },
      voice: require('../services/voice').describe(),
    });
  } catch (err) {
    console.error('Instance overview error:', err);
    res.status(500).json({ error: 'Failed to load instance overview' });
  }
});

// --------------------------------------------------------------------------
// Settings: monthly AI limits and the alert address
// --------------------------------------------------------------------------
router.patch('/settings', async (req, res) => {
  try {
    const body = req.body || {};
    const sets = [];
    const params = [];
    const changed = {};

    if ('monthly_ai_call_limit' in body) {
      const p = parseLimit(body.monthly_ai_call_limit, { integer: true });
      if (p.error) return res.status(400).json({ error: 'Monthly call limit must be a whole number, or empty for no limit' });
      params.push(p.value); sets.push(`monthly_ai_call_limit = $${params.length}`); changed.monthly_ai_call_limit = p.value;
    }
    if ('monthly_ai_budget_usd' in body) {
      const p = parseLimit(body.monthly_ai_budget_usd, { integer: false });
      if (p.error) return res.status(400).json({ error: 'Monthly budget must be a number, or empty for no limit' });
      params.push(p.value); sets.push(`monthly_ai_budget_usd = $${params.length}`); changed.monthly_ai_budget_usd = p.value;
    }
    if ('alert_email' in body) {
      const email = String(body.alert_email || '').trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Alert email is not a valid address' });
      params.push(email || null); sets.push(`alert_email = $${params.length}`); changed.alert_email = email || null;
    }
    for (const field of ['default_model', 'default_grading_model']) {
      if (field in body) {
        const id = String(body[field] || '').trim() || null;
        if (id) {
          const known = await pool.query(
            'SELECT 1 FROM ai_models WHERE model_id = $1 AND provider = $2 AND is_available',
            [id, aiModels.currentProvider()]
          );
          if (known.rows.length === 0) return res.status(400).json({ error: 'Choose a model that is listed and available' });
        }
        params.push(id); sets.push(`${field} = $${params.length}`); changed[field] = id;
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    await pool.query(`UPDATE instance_settings SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP`, params);
    await aiModels.refreshDefaults();
    audit(req, { event_type: 'instance_settings_updated', subject_type: 'instance', metadata: changed });
    res.json({ settings: await getSettings() });
  } catch (err) {
    console.error('Instance settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// --------------------------------------------------------------------------
// AI usage
// --------------------------------------------------------------------------
router.get('/usage', async (req, res) => {
  const { since, until } = req.query;
  if (!validDate(since) || !validDate(until)) return res.status(400).json({ error: 'Invalid date' });
  try {
    let where = '1=1';
    let whereJoined = '1=1';
    const params = [];
    if (since) { params.push(since); where += ` AND created_at >= $${params.length}`; whereJoined += ` AND u.created_at >= $${params.length}`; }
    if (until) { params.push(until); where += ` AND created_at <= $${params.length}`; whereJoined += ` AND u.created_at <= $${params.length}`; }

    const [summary, daily, byModel, byType, top] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS calls, COALESCE(SUM(total_tokens),0)::bigint AS tokens,
                COALESCE(SUM(cost_usd),0) AS cost_usd,
                COUNT(*) FILTER (WHERE cost_usd IS NULL)::int AS unpriced_calls
           FROM ai_usage WHERE ${where}`, params),
      pool.query(
        `SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS calls,
                COALESCE(SUM(total_tokens),0)::bigint AS tokens, COALESCE(SUM(cost_usd),0) AS cost_usd
           FROM ai_usage
          WHERE ${where} AND created_at >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY day ORDER BY day`, params),
      pool.query(
        `SELECT model_id, COUNT(*)::int AS calls, COALESCE(SUM(total_tokens),0)::bigint AS tokens,
                SUM(cost_usd) AS cost_usd
           FROM ai_usage WHERE ${where}
          GROUP BY model_id ORDER BY calls DESC`, params),
      pool.query(
        `SELECT call_type, COUNT(*)::int AS calls, COALESCE(SUM(total_tokens),0)::bigint AS tokens
           FROM ai_usage WHERE ${where}
          GROUP BY call_type ORDER BY calls DESC`, params),
      pool.query(
        `SELECT u.assignment_id, a.title, c.name AS course_name, COUNT(*)::int AS calls,
                COALESCE(SUM(u.total_tokens),0)::bigint AS tokens, SUM(u.cost_usd) AS cost_usd
           FROM ai_usage u
           LEFT JOIN assignments a ON u.assignment_id = a.id
           LEFT JOIN courses c ON a.course_id = c.id
          WHERE ${whereJoined}
          GROUP BY u.assignment_id, a.title, c.name
          ORDER BY calls DESC LIMIT 10`, params),
    ]);

    res.json({
      summary: summary.rows[0],
      daily: daily.rows,
      by_model: byModel.rows,
      by_call_type: byType.rows,
      top_assignments: top.rows,
      month_to_date: await monthToDate(),
      settings: await getSettings(),
    });
  } catch (err) {
    console.error('Instance usage error:', err);
    res.status(500).json({ error: 'Failed to load AI usage' });
  }
});

// --------------------------------------------------------------------------
// Models offered to instructors, and optional prices for cost tracking
// --------------------------------------------------------------------------
const modelRow = (r) => ({
  id: r.id,
  model_id: r.model_id,
  name: r.display_name,
  provider: r.provider,
  is_available: r.is_available,
  input_cost_per_1k: r.input_cost_per_1k,
  output_cost_per_1k: r.output_cost_per_1k,
});

function parsePrice(v) {
  if (v === null || v === '' || v === undefined) return { value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { error: true };
  return { value: n };
}

router.get('/ai-models', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ai_models WHERE provider = $1 ORDER BY display_name`, [aiModels.currentProvider()]
    );
    const ai = await aiModels.describe();
    res.json({
      provider: ai.provider,
      provider_name: ai.provider_name,
      default_model: ai.default_model,
      default_grading_model: ai.default_grading_model,
      default_sources: aiModels.defaultSources(),
      settings: await getSettings(),
      models: rows.map(modelRow),
    });
  } catch (err) {
    console.error('Instance models error:', err);
    res.status(500).json({ error: 'Failed to load models' });
  }
});

router.post('/ai-models', async (req, res) => {
  try {
    const modelId = String(req.body?.model_id || '').trim();
    const name = String(req.body?.name || '').trim() || modelId;
    if (!modelId) return res.status(400).json({ error: 'Model ID is required' });
    const inP = parsePrice(req.body?.input_cost_per_1k);
    const outP = parsePrice(req.body?.output_cost_per_1k);
    if (inP.error || outP.error) return res.status(400).json({ error: 'Prices must be non-negative numbers, or empty' });

    const { rows } = await pool.query(
      `INSERT INTO ai_models (model_id, display_name, provider, input_cost_per_1k, output_cost_per_1k, is_available)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (model_id) DO NOTHING
       RETURNING *`,
      [modelId, name, aiModels.currentProvider(), inP.value, outP.value]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'A model with this ID already exists' });
    audit(req, { event_type: 'ai_model_added', subject_type: 'ai_model', subject_id: rows[0].id, metadata: { model_id: modelId } });
    res.status(201).json({ model: modelRow(rows[0]) });
  } catch (err) {
    console.error('Instance add model error:', err);
    res.status(500).json({ error: 'Failed to add model' });
  }
});

router.patch('/ai-models/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const sets = [];
    const params = [];
    const changed = {};
    if ('name' in body) {
      const name = String(body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
      params.push(name); sets.push(`display_name = $${params.length}`); changed.name = name;
    }
    if ('is_available' in body) {
      params.push(!!body.is_available); sets.push(`is_available = $${params.length}`); changed.is_available = !!body.is_available;
    }
    for (const field of ['input_cost_per_1k', 'output_cost_per_1k']) {
      if (field in body) {
        const p = parsePrice(body[field]);
        if (p.error) return res.status(400).json({ error: 'Prices must be non-negative numbers, or empty' });
        params.push(p.value); sets.push(`${field} = $${params.length}`); changed[field] = p.value;
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE ai_models SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Model not found' });
    clearPriceCache();
    audit(req, { event_type: 'ai_model_updated', subject_type: 'ai_model', subject_id: rows[0].id, metadata: { model_id: rows[0].model_id, ...changed } });
    res.json({ model: modelRow(rows[0]) });
  } catch (err) {
    console.error('Instance update model error:', err);
    res.status(500).json({ error: 'Failed to update model' });
  }
});

// Ask the provider which models this account can use, so the administrator
// can add them without typing IDs. Not every provider can answer.
router.get('/ai-models/discover', async (req, res) => {
  try {
    const provider = getProvider({ model: aiModels.defaultModel() || 'model-listing', region: process.env.AWS_BEDROCK_REGION });
    if (typeof provider.listModels !== 'function') {
      return res.json({ supported: false, models: [] });
    }
    const found = await provider.listModels();
    const { rows } = await pool.query('SELECT model_id FROM ai_models WHERE provider = $1', [aiModels.currentProvider()]);
    const listed = new Set(rows.map((r) => r.model_id));
    res.json({ supported: true, models: found.map((m) => ({ ...m, listed: listed.has(m.id) })) });
  } catch (err) {
    res.json({ supported: true, models: [], error: `${err.message}`.slice(0, 400) });
  }
});

// Send one tiny request to a model to confirm the provider, its credentials
// and the model ID all work. Costs a few tokens; not counted in usage.
router.post('/ai-test', async (req, res) => {
  const modelId = String(req.body?.model_id || '').trim() || aiModels.defaultModel();
  if (!modelId) return res.json({ ok: false, error: 'No model to test: add a model and choose a default first.' });
  const started = Date.now();
  try {
    const provider = getProvider({ model: modelId, region: process.env.AWS_BEDROCK_REGION });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('No response within 30 seconds')), 30_000));
    const result = await Promise.race([
      provider.chat({
        systemPrompt: 'You are a connection test. Reply with the single word OK.',
        messages: [{ role: 'user', content: 'Connection test.' }],
        options: { max_tokens: 16 },
      }),
      timeout,
    ]);
    res.json({ ok: true, model_id: modelId, latency_ms: Date.now() - started, reply: String(result.content || '').slice(0, 80) });
  } catch (err) {
    // Provider errors here are configuration feedback for the administrator.
    const label = err.name && err.name !== 'Error' && err.name !== 'AIProviderError' ? `${err.name}: ` : '';
    res.json({ ok: false, model_id: modelId, latency_ms: Date.now() - started, error: `${label}${err.message}`.slice(0, 400) });
  }
});

// --------------------------------------------------------------------------
// Grading agreement (instructor blind grades vs AI grades), all courses
// --------------------------------------------------------------------------
router.get('/grading-agreement', async (req, res) => {
  try {
    const matches = `COUNT(*) FILTER (WHERE ga.human_level IS NOT NULL AND ga.ai_level IS NOT NULL
                AND LOWER(TRIM(ga.human_level)) = LOWER(TRIM(ga.ai_level)))::int AS level_matches`;
    const [summary, byConfidence, byAssignment] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS pairs,
                COUNT(DISTINCT ga.session_id)::int AS sessions,
                COUNT(DISTINCT ga.assignment_id)::int AS assignments,
                ${matches},
                ROUND(AVG(ABS(ga.human_score - ga.ai_score))::numeric, 2) AS score_mae,
                ROUND(AVG(CASE WHEN ga.max_points > 0
                  THEN ABS(ga.human_score - ga.ai_score) / ga.max_points * 100 END)::numeric, 1) AS score_mae_pct
           FROM grading_agreement ga`),
      pool.query(
        `SELECT COALESCE(ga.ai_confidence, 'unreported') AS confidence,
                COUNT(*)::int AS pairs, ${matches},
                ROUND(AVG(ABS(ga.human_score - ga.ai_score))::numeric, 2) AS score_mae
           FROM grading_agreement ga
          GROUP BY COALESCE(ga.ai_confidence, 'unreported')
          ORDER BY CASE COALESCE(ga.ai_confidence, 'unreported')
            WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`),
      pool.query(
        `SELECT ga.assignment_id, MAX(a.title) AS assignment_title, MAX(c.name) AS course_name,
                COUNT(*)::int AS pairs, COUNT(DISTINCT ga.session_id)::int AS sessions, ${matches},
                ROUND(AVG(ABS(ga.human_score - ga.ai_score))::numeric, 2) AS score_mae
           FROM grading_agreement ga
           JOIN assignments a ON ga.assignment_id = a.id
           LEFT JOIN courses c ON a.course_id = c.id
          GROUP BY ga.assignment_id
          ORDER BY COUNT(*) DESC
          LIMIT 50`),
    ]);
    res.json({ summary: summary.rows[0], by_confidence: byConfidence.rows, by_assignment: byAssignment.rows });
  } catch (err) {
    console.error('Instance grading agreement error:', err);
    res.status(500).json({ error: 'Failed to load grading agreement' });
  }
});

// --------------------------------------------------------------------------
// Audit log
// --------------------------------------------------------------------------
router.get('/audit-events', async (req, res) => {
  const { actor_type, event_type, since, until } = req.query;
  if (!validDate(since) || !validDate(until)) return res.status(400).json({ error: 'Invalid date' });
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  try {
    let where = '1=1';
    const params = [];
    if (actor_type) { params.push(actor_type); where += ` AND ae.actor_type = $${params.length}`; }
    if (event_type) { params.push(event_type); where += ` AND ae.event_type = $${params.length}`; }
    if (since) { params.push(since); where += ` AND ae.created_at >= $${params.length}`; }
    if (until) { params.push(until); where += ` AND ae.created_at <= $${params.length}`; }

    const total = await pool.query(`SELECT COUNT(*)::int AS n FROM audit_events ae WHERE ${where}`, params);
    const { rows } = await pool.query(
      `SELECT ae.id, ae.actor_type, ae.actor_id, ae.event_type, ae.subject_type, ae.subject_id,
              ae.metadata, ae.created_at, u.name AS actor_name
         FROM audit_events ae
         LEFT JOIN users u ON ae.actor_type <> 'system' AND ae.actor_id = u.id
        WHERE ${where}
        ORDER BY ae.created_at DESC, ae.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const types = await pool.query('SELECT DISTINCT event_type FROM audit_events ORDER BY event_type');
    res.json({ events: rows, total: total.rows[0].n, event_types: types.rows.map((r) => r.event_type) });
  } catch (err) {
    console.error('Instance audit events error:', err);
    res.status(500).json({ error: 'Failed to load audit events' });
  }
});

// --------------------------------------------------------------------------
// Data export: everything this installation holds, as one JSON document.
// Contains student names, emails and full conversation transcripts.
// --------------------------------------------------------------------------
router.get('/export', async (req, res) => {
  try {
    const table = async (sql) => (await pool.query(sql)).rows;
    const data = {
      exported_at: new Date().toISOString(),
      version,
      platforms: await table('SELECT id, url, client_id, display_name, registration_status, registered_at, first_launch_at FROM lti_platforms ORDER BY id'),
      courses: await table('SELECT * FROM courses ORDER BY id'),
      users: await table('SELECT * FROM users ORDER BY id'),
      course_enrollments: await table('SELECT * FROM course_enrollments ORDER BY id'),
      assignments: await table('SELECT * FROM assignments ORDER BY id'),
      assignment_templates: await table('SELECT * FROM assignment_templates ORDER BY id'),
      sessions: await table('SELECT * FROM simulation_sessions ORDER BY id'),
      interactions: await table('SELECT * FROM simulation_interactions ORDER BY id'),
      grade_submissions: await table('SELECT * FROM grade_submissions ORDER BY id'),
      session_feedback: await table('SELECT * FROM session_feedback ORDER BY id'),
      grading_agreement: await table('SELECT * FROM grading_agreement ORDER BY id'),
      ai_usage: await table('SELECT * FROM ai_usage ORDER BY id'),
      ai_models: await table('SELECT * FROM ai_models ORDER BY id'),
      instance_settings: await table('SELECT * FROM instance_settings'),
      audit_events: await table('SELECT * FROM audit_events ORDER BY id'),
    };
    audit(req, {
      event_type: 'instance_exported',
      subject_type: 'instance',
      metadata: { courses: data.courses.length, assignments: data.assignments.length, sessions: data.sessions.length },
    });
    const stamp = data.exported_at.slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="ltisim-export-${stamp}.json"`);
    res.json(data);
  } catch (err) {
    console.error('Instance export error:', err);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

module.exports = router;
