// LMS (LTI platform) registration for a single-LMS instance.
//
// A platform lives in two stores that must agree: ltijs's own platform
// store (keys, launch validation) and our lti_platforms table (the registry
// every launch is checked against, and the platform_id all data hangs off).
//
// Two ways to register the LMS, both before anyone can launch the tool:
//   1. Environment variables (LMS_TYPE, LMS_URL, LMS_CLIENT_ID, …) applied
//      at boot — see registerFromEnv().
//   2. LTI Dynamic Registration using the one-time setup link printed at
//      boot — see getSetupToken() and config/lti.js.
//
// Registration closes as soon as one platform exists; `npm run
// platform:reset` reopens it.
const crypto = require('crypto');
const pool = require('../config/database');
const { logAuditEvent } = require('../utils/audit-log');

const publicUrl = () => (process.env.PUBLIC_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');

// Tool-side values an LMS administrator needs when configuring the tool
// by hand (Canvas Developer Key, Moodle external tool).
function toolConfig() {
  const base = publicUrl();
  return {
    target_link_uri: `${base}/lti`,
    oidc_login_url: `${base}/lti/login`,
    jwks_url: `${base}/keys`,
    redirect_uris: [`${base}/lti`],
  };
}

// Well-known LTI endpoints per LMS. Cloud-hosted Canvas (instructure.com,
// including vanity domains) serves all three from sso.canvaslms.com and
// uses a fixed issuer; self-hosted Canvas and Moodle serve them from the
// instance's own domain.
function endpointPreset(type, lmsUrl) {
  const base = (lmsUrl || '').trim().replace(/\/$/, '');
  switch (type) {
    case 'canvas-cloud':
      return {
        issuer: 'https://canvas.instructure.com',
        auth_endpoint: 'https://sso.canvaslms.com/api/lti/authorize_redirect',
        token_endpoint: 'https://sso.canvaslms.com/login/oauth2/token',
        key_set_url: 'https://sso.canvaslms.com/api/lti/security/jwks',
      };
    case 'canvas-self':
      return {
        issuer: base,
        auth_endpoint: `${base}/api/lti/authorize_redirect`,
        token_endpoint: `${base}/login/oauth2/token`,
        key_set_url: `${base}/api/lti/security/jwks`,
      };
    case 'moodle':
      return {
        issuer: base,
        auth_endpoint: `${base}/mod/lti/auth.php`,
        token_endpoint: `${base}/mod/lti/token.php`,
        key_set_url: `${base}/mod/lti/certs.php`,
      };
    default:
      return { issuer: base };
  }
}

async function activePlatform() {
  const { rows } = await pool.query(
    `SELECT * FROM lti_platforms WHERE registration_status != 'disabled' ORDER BY id LIMIT 1`
  );
  return rows[0] || null;
}

// True while no LMS is registered yet.
async function registrationOpen() {
  return (await activePlatform()) === null;
}

/**
 * Register a platform in both stores. Rolls back our row if ltijs refuses.
 * Throws an Error with .code = 'REGISTRATION_CLOSED' when a platform exists.
 */
async function registerPlatformBoth(lti, { url, client_id, auth_endpoint, token_endpoint, key_set_url, display_name }, { actor = 'system' } = {}) {
  const missing = Object.entries({ url, client_id, auth_endpoint, token_endpoint, key_set_url })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing platform fields: ${missing.join(', ')}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE lti_platforms IN EXCLUSIVE MODE');
    const existing = await client.query(
      `SELECT id FROM lti_platforms WHERE registration_status != 'disabled' OR url = $1`, [url]
    );
    if (existing.rows.length > 0) {
      const err = new Error('An LMS is already registered with this instance');
      err.code = 'REGISTRATION_CLOSED';
      throw err;
    }
    const inserted = await client.query(
      `INSERT INTO lti_platforms
         (url, client_id, auth_endpoint, token_endpoint, key_set_url,
          display_name, registration_status, registered_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', CURRENT_TIMESTAMP)
       RETURNING *`,
      [url, client_id, auth_endpoint, token_endpoint, key_set_url, display_name || url]
    );
    await lti.registerPlatform({
      url,
      name: display_name || url,
      clientId: client_id,
      authenticationEndpoint: auth_endpoint,
      accesstokenEndpoint: token_endpoint,
      authorizationServer: token_endpoint,
      authConfig: { method: 'JWK_SET', key: key_set_url },
    });
    await client.query('COMMIT');
    const row = inserted.rows[0];
    logAuditEvent({
      actor_type: actor,
      event_type: 'platform_created',
      subject_type: 'platform',
      subject_id: row.id,
      metadata: { url, client_id },
    });
    return row;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Platform definition from LMS_* environment variables, or null if unset.
function platformFromEnv(env = process.env) {
  if (!env.LMS_CLIENT_ID) return null;
  const preset = endpointPreset(env.LMS_TYPE, env.LMS_URL);
  return {
    url: env.LMS_ISSUER || preset.issuer,
    client_id: env.LMS_CLIENT_ID,
    auth_endpoint: env.LMS_AUTH_ENDPOINT || preset.auth_endpoint,
    token_endpoint: env.LMS_TOKEN_ENDPOINT || preset.token_endpoint,
    key_set_url: env.LMS_KEYSET_URL || preset.key_set_url,
    display_name: env.LMS_NAME || env.LMS_URL || preset.issuer,
  };
}

// Idempotent: registers the LMS described by the environment if none is
// registered yet. Returns the new row, or null when nothing was done.
async function registerFromEnv(lti) {
  const def = platformFromEnv();
  if (!def) return null;
  if (!(await registrationOpen())) return null;
  const row = await registerPlatformBoth(lti, def);
  console.log(`[setup] Registered LMS ${row.url} (client ${row.client_id}) from environment`);
  return row;
}

// Remove every registered platform from both stores (reopens registration).
// Refuses when course data exists unless force is set, because all data is
// tied to the platform row.
async function resetPlatforms(lti, { force = false } = {}) {
  const { rows } = await pool.query('SELECT id, url, client_id FROM lti_platforms');
  const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM courses');
  if (n > 0 && !force) {
    const err = new Error(`${n} course(s) exist for the registered LMS; rerun with --force to delete the platform and ALL its data`);
    err.code = 'HAS_DATA';
    throw err;
  }
  for (const p of rows) {
    await lti.deletePlatform(p.url, p.client_id).catch((e) => console.warn('[setup] ltijs deletePlatform:', e.message));
  }
  // Child rows without ON DELETE CASCADE must go first.
  await pool.query('DELETE FROM grading_agreement');
  await pool.query('DELETE FROM simulation_sessions');
  await pool.query('DELETE FROM lti_platforms');
  return rows.length;
}

// --- One-time setup token for dynamic registration ---------------------
// SETUP_TOKEN from the environment, or a random one generated per process.
let generatedToken = null;
function getSetupToken() {
  if (process.env.SETUP_TOKEN) return process.env.SETUP_TOKEN;
  if (!generatedToken) generatedToken = crypto.randomBytes(24).toString('base64url');
  return generatedToken;
}

function setupTokenMatches(candidate) {
  const a = crypto.createHash('sha256').update(String(candidate || '')).digest();
  const b = crypto.createHash('sha256').update(getSetupToken()).digest();
  return crypto.timingSafeEqual(a, b);
}

function dynamicRegistrationUrl() {
  return `${publicUrl()}/lti/register?tok=${encodeURIComponent(getSetupToken())}`;
}

module.exports = {
  publicUrl,
  toolConfig,
  endpointPreset,
  activePlatform,
  registrationOpen,
  registerPlatformBoth,
  platformFromEnv,
  registerFromEnv,
  resetPlatforms,
  setupTokenMatches,
  dynamicRegistrationUrl,
};
