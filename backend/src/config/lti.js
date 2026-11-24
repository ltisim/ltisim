const lti = require('ltijs').Provider;
const path = require('path');
const Database = require('ltijs-sequelize');
const pool = require('./database');
const { logAuditEvent } = require('../utils/audit-log');
const platforms = require('../services/platforms');
const { recordLaunch } = require('../utils/launch');
require('dotenv').config();

// Deep-linking tokens, DB-backed (deep_link_tokens, migrate-v21) so any
// instance behind the load balancer can complete a deep-link flow that
// another instance started. Keys are hashed; rows expire after 10 minutes
// with opportunistic cleanup on each store.
const crypto = require('crypto');
const DEEP_LINK_TOKEN_TTL_MINUTES = 10;

const hashDeepLinkKey = (key) =>
  crypto.createHash('sha256').update(String(key)).digest('hex');

// Check a launching platform against our registry. Returns { platformId }
// or { reject: html }. A pending platform is verified on its first launch.
async function gatePlatform(platformUrl, token, req) {
  const { rows } = await pool.query(
    'SELECT id, client_id, registration_status FROM lti_platforms WHERE url = $1',
    [platformUrl]
  );
  const row = rows[0];
  if (!row || (token.clientId && String(row.client_id) !== String(token.clientId))) {
    logAuditEvent({
      actor_type: 'system',
      event_type: 'launch_rejected_unknown_platform',
      metadata: { platform_url: platformUrl, client_id: token.clientId, lti_user_id: token.user },
      req,
    });
    return {
      reject: '<h1>Tool not configured for this institution</h1>' +
        '<p>This LTI tool is not registered for your learning platform. ' +
        'Please contact your administrator to request access.</p>',
    };
  }
  if (row.registration_status === 'disabled') {
    logAuditEvent({
      actor_type: 'system',
      event_type: 'launch_rejected_platform_disabled',
      subject_type: 'platform',
      subject_id: row.id,
      metadata: { platform_url: platformUrl, lti_user_id: token.user },
      req,
    });
    return {
      reject: '<h1>Tool temporarily unavailable</h1>' +
        '<p>This LTI tool has been disabled for your institution. ' +
        'Please contact your administrator.</p>',
    };
  }
  if (row.registration_status === 'pending') {
    await pool.query(
      `UPDATE lti_platforms
       SET registration_status = 'verified', first_launch_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND registration_status = 'pending'`,
      [row.id]
    );
    logAuditEvent({
      actor_type: 'system',
      event_type: 'platform_verified_on_first_launch',
      subject_type: 'platform',
      subject_id: row.id,
      metadata: { platform_url: platformUrl },
      req,
    });
  }
  return { platformId: row.id };
}

// Extra registration fields per LMS. Canvas only offers a tool where its
// "placements" say so: without them the tool registers but never appears
// in the assignment or module pickers, so instructors could not link an
// LTISim assignment to a gradable Canvas item. Other platforms (Moodle)
// expose deep linking themselves and need nothing extra.
// Custom launch parameter marking a launch from the LMS's admin menu.
const ENTRY_PARAM = 'ltisim_entry';

function registrationOptions(productFamily) {
  if (productFamily !== 'canvas') return {};
  const base = platforms.publicUrl();
  const name = process.env.TOOL_NAME || 'LTISim';
  return {
    'https://purl.imsglobal.org/spec/lti-tool-configuration': {
      // Send names and emails so instructors can tell students apart.
      'https://canvas.instructure.com/lti/privacy_level': 'public',
      messages: [
        // Pick an LTISim assignment when creating a Canvas assignment
        // (Submission Type: External Tool) or adding a module item.
        {
          type: 'LtiDeepLinkingRequest',
          target_link_uri: `${base}/lti`,
          label: name,
          placements: ['assignment_selection', 'link_selection'],
        },
        // Course menu entry to the instructor dashboard. Shown to teachers
        // and admins only: students reach their work through the Canvas
        // assignments that link to it, so they never see this entry.
        {
          type: 'LtiResourceLinkRequest',
          target_link_uri: `${base}/lti`,
          label: name,
          placements: ['course_navigation'],
          'https://canvas.instructure.com/lti/visibility': 'admins',
        },
        // Account admin menu entry: instance administration, no course.
        {
          type: 'LtiResourceLinkRequest',
          target_link_uri: `${base}/lti`,
          label: name,
          placements: ['account_navigation'],
          custom_parameters: { [ENTRY_PARAM]: 'instance' },
        },
      ],
    },
  };
}

async function storeDeepLinkToken(key, token) {
  await pool.query(
    `DELETE FROM deep_link_tokens WHERE expires_at < NOW()`
  );
  await pool.query(
    `INSERT INTO deep_link_tokens (ltik_hash, token, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)
     ON CONFLICT (ltik_hash) DO UPDATE
       SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at`,
    [hashDeepLinkKey(key), JSON.stringify(token), DEEP_LINK_TOKEN_TTL_MINUTES]
  );
}

async function getDeepLinkToken(key) {
  const { rows } = await pool.query(
    `SELECT token FROM deep_link_tokens
     WHERE ltik_hash = $1 AND expires_at >= NOW()`,
    [hashDeepLinkKey(key)]
  );
  return rows.length > 0 ? rows[0].token : null;
}

async function removeDeepLinkToken(key) {
  await pool.query(`DELETE FROM deep_link_tokens WHERE ltik_hash = $1`, [
    hashDeepLinkKey(key),
  ]);
}

const setupLTI = async () => {
  // Setup ltijs-sequelize database
  const db = new Database(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD || '',
    {
      host: process.env.DB_HOST,
      dialect: 'postgres',
      logging: process.env.LOG_VERBOSE === '1' ? console.log : false,
      // Same TLS posture as config/database.js — without this, ltijs fails
      // at boot against RDS with rds.force_ssl enabled.
      ...(pool.sslConfig && { dialectOptions: { ssl: pool.sslConfig } }),
    }
  );

  // LTI Provider configuration
  await lti.setup(
    process.env.LTI_KEY,
    {
      plugin: db,
      // External URL for reverse proxy setup
      url: process.env.FRONTEND_URL
    },
    {
      appRoute: '/lti',
      loginRoute: '/lti/login',
      keysetRoute: '/keys',
      sessionTimeoutUrl: `${process.env.FRONTEND_URL}/session-timeout`,
      invalidTokenUrl: `${process.env.FRONTEND_URL}/invalid-token`,
      cookies: {
        secure: true,
        sameSite: 'None'
      },
      // devMode relaxes ltijs's state-cookie validation on launch. Third-party
      // cookie blocking (Safari always; Chrome increasingly) can break strict
      // validation inside the Canvas iframe, so the flip to 'false' must be
      // verified with a real cross-browser Canvas launch. Until then prod sets
      // LTI_DEV_MODE=true in .env; the default here is the secure setting.
      devMode: process.env.LTI_DEV_MODE === 'true',
      // LTI Dynamic Registration. Gated by the one-time setup token (see
      // onDynamicRegistration below) and only open until an LMS is
      // registered, so the public endpoint cannot be used to attach an
      // arbitrary LMS to this instance.
      dynRegRoute: '/lti/register',
      dynReg: {
        url: process.env.FRONTEND_URL,
        name: process.env.TOOL_NAME || 'LTISim',
        description: 'AI-powered simulation assignments with rubric-aligned, instructor-reviewed grading.',
        redirectUris: [],
        // ltijs-side activation is fine: our own lti_platforms registry (below)
        // still gates every launch, so an ltijs-active platform without a
        // row there is rejected at launch time.
        autoActivate: true,
      }
    }
  );

  // Whitelist the frontend domain and LTI launch URL
  lti.whitelist(process.env.FRONTEND_URL);
  lti.whitelist(`${process.env.FRONTEND_URL}/lti`);

  // Set up LTI launch handler
  lti.onConnect(async (token, req, res) => {
    console.log(`LTI Launch received: platform=${token.iss} user=${token.user} context=${token.platformContext?.contextId || '?'}`);
    if (process.env.LOG_VERBOSE === '1') {
      console.log('Full LTI Token:', JSON.stringify(token, null, 2));
    }

    try {
      const platformUrl = token.iss;

      // Resolve platform. The LMS must be registered (environment variables
      // or the setup link) before it can launch; a launch from any other
      // platform is rejected outright.
      const gate = await gatePlatform(platformUrl, token, req);
      if (gate.reject) return res.status(403).send(gate.reject);

      const instanceEntry = token.platformContext?.custom?.[ENTRY_PARAM] === 'instance';
      const { userId, isInstructor, isInstanceAdmin } = await recordLaunch(
        token, gate.platformId, res.locals.ltik, { noCourse: instanceEntry }
      );

      // Launched from the LMS's admin menu: instance administration only.
      if (instanceEntry) {
        if (!isInstanceAdmin) {
          return res.status(403).send('<h1>Not permitted</h1><p>This page is for administrators of your learning platform.</p>');
        }
        return res.redirect(`${process.env.FRONTEND_URL}/admin/instance?ltik=${res.locals.ltik}`);
      }

      // Redirect to frontend with session token
      const sessionToken = res.locals.ltik;

      // Redirect to admin dashboard for instructors, otherwise to main page
      if (isInstructor) {
        return res.redirect(`${process.env.FRONTEND_URL}/admin?ltik=${sessionToken}`);
      } else {
        // Check if this is a deep-linked assignment launch
        const assignmentId = token.platformContext?.custom?.assignment_id;
        if (assignmentId) {
          // Check if student has completed attempts (and no in-progress session)
          const sessionResult = await pool.query(
            `SELECT status FROM simulation_sessions
             WHERE user_id = $1 AND assignment_id = $2`,
            [userId, assignmentId]
          );
          const hasInProgress = sessionResult.rows.some(s => s.status === 'in_progress');
          const hasCompleted = sessionResult.rows.some(s => s.status === 'completed');

          if (hasCompleted && !hasInProgress) {
            // Has completed attempts, no active session - show dashboard
            return res.redirect(`${process.env.FRONTEND_URL}?ltik=${sessionToken}`);
          }

          // First attempt or resuming in-progress - go directly to simulation
          return res.redirect(`${process.env.FRONTEND_URL}/simulation?assignmentId=${assignmentId}&ltik=${sessionToken}`);
        }
        return res.redirect(`${process.env.FRONTEND_URL}?ltik=${sessionToken}`);
      }

    } catch (error) {
      console.error('LTI Connect error:', error);
      return res.status(500).send('Error processing LTI launch');
    }
  });

  // Set up deep linking handler - redirect to frontend picker
  lti.onDeepLinking(async (token, req, res) => {
    try {
      const ltik = res.locals.ltik;
      const gate = await gatePlatform(token.iss, token, req);
      if (gate.reject) return res.status(403).send(gate.reject);
      // Record the launch so the picker's API calls are authorised even when
      // deep linking is the user's first contact with the tool.
      const { isInstructor } = await recordLaunch(token, gate.platformId, ltik);
      if (!isInstructor) return res.status(403).send('<h1>Not permitted</h1><p>Only instructors can add content from this tool.</p>');
      await storeDeepLinkToken(ltik, token);
      return res.redirect(`${process.env.FRONTEND_URL}/admin/deep-link?ltik=${ltik}`);
    } catch (err) {
      console.error('Deep linking error:', err);
      return res.status(500).send('Deep linking failed');
    }
  });

  // Dynamic registration handler. The LMS administrator pastes the setup
  // link printed at boot into their LMS; the LMS calls it back with
  // openid_configuration + registration_token, preserving our ?tok= query
  // param. We verify the setup token, run ltijs's standard registration,
  // then mirror the new platform into lti_platforms with registration_status
  // 'pending' (flips to 'verified' on first launch).
  lti.onDynamicRegistration(async (req, res) => {
    const rejectHtml = (title, body) =>
      res.status(403).send(`<h1>${title}</h1><p>${body}</p>`);
    try {
      if (!req.query.openid_configuration) {
        return res.status(400).send({ status: 400, error: 'Bad Request', details: { message: 'Missing parameter: "openid_configuration".' } });
      }

      // 1. Verify the setup token BEFORE fetching anything: this check is
      //    what stops the endpoint being used to make the server fetch
      //    arbitrary URLs.
      if (!platforms.setupTokenMatches(req.query.tok)) {
        logAuditEvent({
          actor_type: 'system',
          event_type: 'dynreg_rejected_invalid_token',
          req,
        });
        return rejectHtml(
          'Registration link invalid',
          'This registration URL does not carry the current setup token. Use the link printed in the server log at startup.'
        );
      }
      if (!(await platforms.registrationOpen())) {
        return rejectHtml(
          'Already registered',
          'An LMS is already registered with this instance. To replace it, run "npm run platform:reset" on the server first.'
        );
      }

      // 2. Learn the issuer up front so we can mirror the platform afterwards
      const openidConfig = await (await fetch(req.query.openid_configuration)).json();
      const issuer = openidConfig.issuer;

      // 3. Standard ltijs registration (fetch config, POST registration,
      //    store platform + activate)
      const productFamily = openidConfig['https://purl.imsglobal.org/spec/lti-platform-configuration']?.product_family_code;
      const message = await lti.DynamicRegistration.register(
        req.query.openid_configuration,
        req.query.registration_token,
        registrationOptions(productFamily)
      );

      // 4. Mirror into lti_platforms. ltijs keys platforms by
      //    (url, clientId); ours is one row per URL, matching the
      //    launch-time lookup.
      const ltijsPlatforms = await lti.getPlatform(issuer);
      const platformList = Array.isArray(ltijsPlatforms) ? ltijsPlatforms : (ltijsPlatforms ? [ltijsPlatforms] : []);
      for (const p of platformList) {
        const clientId = await p.platformClientId();
        const productCode = openidConfig['https://purl.imsglobal.org/spec/lti-platform-configuration']?.product_family_code || 'LMS';
        const inserted = await pool.query(
          `INSERT INTO lti_platforms
             (display_name, url, client_id, auth_endpoint, token_endpoint, key_set_url,
              registration_status, registered_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', CURRENT_TIMESTAMP)
           ON CONFLICT (url) DO NOTHING
           RETURNING id`,
          [
            `${productCode} (dynamic registration)`,
            issuer,
            clientId,
            openidConfig.authorization_endpoint,
            openidConfig.token_endpoint,
            openidConfig.jwks_uri,
          ]
        );
        if (inserted.rows.length > 0) {
          logAuditEvent({
            actor_type: 'system',
            event_type: 'platform_dynamically_registered',
            subject_type: 'platform',
            subject_id: inserted.rows[0].id,
            metadata: { platform_url: issuer, client_id: clientId, product: productCode },
            req,
          });
          console.log(`Dynamic registration: platform ${issuer} (client ${clientId}) registered`);
        }
      }

      res.setHeader('Content-type', 'text/html');
      return res.send(message);
    } catch (err) {
      console.error('Dynamic registration error:', err.message);
      if (err.message === 'PLATFORM_ALREADY_REGISTERED') {
        return rejectHtml('Already registered', 'This LMS is already registered with this instance.');
      }
      return res.status(500).send({ status: 500, error: 'Internal Server Error', details: { message: 'Dynamic registration failed.' } });
    }
  });

  // Add error handlers for debugging
  lti.onInvalidToken(async (req, res) => {
    console.error('Invalid token received');
    console.error('Request URL:', req.url);
    console.error('Request body:', req.body);

    // Try to debug platform lookup
    if (req.body && req.body.iss && req.body.client_id) {
      try {
        const platform = await lti.getPlatform(req.body.iss, req.body.client_id);
        console.error('Platform lookup result:', platform ? 'FOUND' : 'NOT FOUND');
        if (platform) {
          console.error('Platform details:', JSON.stringify(await platform.platformJSON(), null, 2));
        }
      } catch (e) {
        console.error('Platform lookup error:', e.message);
      }
    }

    return res.status(401).send('Invalid token');
  });

  lti.onUnregisteredPlatform((req, res) => {
    console.error('Unregistered platform attempted connection');
    console.error('Request URL:', req.url);
    console.error('Request body:', req.body);
    return res.status(401).send('Unregistered platform');
  });

  // Deploy and register platform
  await lti.deploy({ serverless: true });

  console.log('LTI Provider configured successfully');

  return lti;
};

module.exports = { setupLTI, getDeepLinkToken, removeDeepLinkToken };
