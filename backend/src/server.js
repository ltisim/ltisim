const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const { setupLTI } = require('./config/lti');
const pool = require('./config/database');

// Import routes
const simulationRoutes = require('./routes/simulation');
const gradeRoutes = require('./routes/grades');
const adminRoutes = require('./routes/admin');
const authoringRoutes = require('./routes/authoring');
const instanceRoutes = require('./routes/instance');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind one reverse-proxy hop by default (set TRUST_PROXY_HOPS to match
// your deployment). Required so req.ip / req.secure reflect the client, not the proxy —
// without it every rate limiter buckets all users into one 127.0.0.1 counter.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));

// Request logging middleware. Default: one line per request with tokens
// redacted — headers, bodies, and response payloads carry session tokens,
// cookies, and student conversation content, none of which belong in the
// journal. Set LOG_VERBOSE=1 to restore full debug logging temporarily.
const VERBOSE_LOG = process.env.LOG_VERBOSE === '1';
const redactUrl = (url) => url.replace(/([?&](?:ltik|token|tok|refresh_token|openid_configuration|registration_token)=)[^&]+/gi, '$1[redacted]');
app.use((req, res, next) => {
  const startedAt = Date.now();
  if (VERBOSE_LOG) {
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    if (req.body && Object.keys(req.body).length > 0) {
      console.log('Body:', JSON.stringify(req.body, null, 2));
    }
  }
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${redactUrl(req.originalUrl)} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
});

// Middleware
// PUBLIC_URL is the canonical name; FRONTEND_URL is the legacy alias.
if (process.env.PUBLIC_URL && !process.env.FRONTEND_URL) process.env.FRONTEND_URL = process.env.PUBLIC_URL;
const allowedOrigins = [process.env.FRONTEND_URL].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/simulation', simulationRoutes);
app.use('/api/grades', gradeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', authoringRoutes); // authoring assist + duplicate/export/import/templates
app.use('/api/instance', instanceRoutes); // instance administration (LMS administrators)

// Initialize LTI and start server
const startServer = async () => {
  try {
    // Test database connection
    await pool.query('SELECT NOW()');
    console.log('Database connection verified');

    // Apply any pending schema migrations (set DB_AUTO_MIGRATE=false to run
    // `npm run db:migrate` yourself instead).
    if (process.env.DB_AUTO_MIGRATE !== 'false') {
      const { migrate } = require('./db/migrate');
      await migrate();
    }

    // Install the sample assignment gallery on a brand-new installation.
    const samples = await require('./utils/seed-templates').seedTemplatesIfEmpty();
    if (samples > 0) console.log(`[setup] Installed ${samples} sample assignment templates`);

    // Load the administrator's default models before any AI call.
    await require('./services/ai/models').refreshDefaults();

    // Setup LTI
    const lti = await setupLTI();

    // Serve the built frontend when present (the container image ships it).
    // MUST mount BEFORE lti.app: ltijs validates every path it sees, so SPA
    // routes like /admin would otherwise die with "Invalid token". The
    // fallback is GET-only and skips /api, /lti, /keys, /health — LTI launch
    // POSTs and OIDC logins fall through to ltijs untouched.
    const path = require('path');
    const fs = require('fs');
    const DIST_DIR = path.join(__dirname, '..', '..', 'frontend', 'dist');
    if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
      app.use(express.static(DIST_DIR, { maxAge: '1y', index: false }));
      app.get('*', (req, res, next) => {
        if (/^\/(api|lti|keys|health)\b/.test(req.path)) return next();
        res.sendFile(path.join(DIST_DIR, 'index.html'), {
          headers: { 'Cache-Control': 'no-cache' },
        });
      });
      console.log('Serving frontend statically from', DIST_DIR);
    }

    // Register LTI routes with Express
    app.use(lti.app);

    // First-run setup: register the LMS from LMS_* environment variables if
    // given; otherwise print the one-time dynamic-registration link.
    const platforms = require('./services/platforms');
    await platforms.registerFromEnv(lti);
    if (await platforms.registrationOpen()) {
      const cfg = platforms.toolConfig();
      console.log('\n[setup] No LMS is registered yet. Either:');
      console.log('[setup]   - paste this registration link into your LMS:');
      console.log(`[setup]       ${platforms.dynamicRegistrationUrl()}`);
      console.log('[setup]   - or set LMS_TYPE, LMS_URL and LMS_CLIENT_ID and restart.');
      console.log(`[setup]   Tool URLs for manual setup: launch ${cfg.target_link_uri}, login ${cfg.oidc_login_url}, keys ${cfg.jwks_url}\n`);
    }

    // Grade-passback retry worker (must start after ltijs init — it calls
    // lti.Grade.scorePublish). Each tick catches its own errors.
    const { startGradePassbackWorker } = require('./utils/grade-passback');
    startGradePassbackWorker({ intervalMs: 60_000 });

    // Evaluation retry worker: re-runs failed AI evaluations so a grading
    // outage surfaces as "evaluation pending", never as a fabricated score.
    const { startEvaluationRetryWorker } = require('./utils/evaluation-retry');
    startEvaluationRetryWorker({ intervalMs: 60_000 });

    // Warn at boot if any configured model lacks pricing (cost_usd would log NULL).
    const { checkModelPricing } = require('./utils/model-pricing-check');
    checkModelPricing();

    // Start server (capture the http.Server so the voice WS can attach)
    // HOST limits the bind address (e.g. 127.0.0.1 behind a reverse proxy).
    const server = app.listen(PORT, process.env.HOST || undefined, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
      console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
    });

    // Voice input: WebSocket → Amazon Transcribe streaming relay.
    const { attachVoiceWs } = require('./ws/voice-ws');
    attachVoiceWs(server);

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Handle uncaught errors
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  process.exit(1);
});

startServer();
