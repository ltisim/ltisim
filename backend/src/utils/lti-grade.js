const pool = require('../config/database');
const lti = require('ltijs').Provider;

/**
 * Reconstruct the ltijs idtoken object from the decoded ltik JWT fields.
 * Queries the ltijs-managed idtokens and contexttokens tables to build
 * the token object that lti.Grade.scorePublish() expects.
 */
async function getLtiIdToken(decodedLtik) {
  const { platformUrl, clientId, deploymentId, contextId, user } = decodedLtik;

  const idtokenResult = await pool.query(
    `SELECT * FROM idtokens
     WHERE iss = $1 AND "clientId" = $2 AND "deploymentId" = $3 AND "user" = $4
     ORDER BY "updatedAt" DESC LIMIT 1`,
    [platformUrl, clientId, deploymentId, user]
  );
  if (idtokenResult.rows.length === 0) return null;

  const contextResult = await pool.query(
    `SELECT * FROM contexttokens
     WHERE "contextId" = $1 AND "user" = $2
     ORDER BY "updatedAt" DESC LIMIT 1`,
    [contextId, user]
  );
  if (contextResult.rows.length === 0) return null;

  const idtoken = idtokenResult.rows[0];
  const ctx = contextResult.rows[0];

  return {
    iss: idtoken.iss,
    clientId: idtoken.clientId,
    deploymentId: idtoken.deploymentId,
    user: idtoken.user,
    userInfo: idtoken.userInfo,
    platformInfo: idtoken.platformInfo,
    platformContext: {
      contextId: ctx.contextId,
      path: ctx.path,
      roles: ctx.roles,
      targetLinkUri: ctx.targetLinkUri,
      context: ctx.context,
      resource: ctx.resource,
      custom: ctx.custom,
      endpoint: ctx.endpoint,
      namesRoles: ctx.namesRoles,
      lis: ctx.lis,
      launchPresentation: ctx.launchPresentation,
      messageType: ctx.messageType,
      version: ctx.version,
      deepLinkingSettings: ctx.deepLinkingSettings,
    },
  };
}

/**
 * Publish a grade via LTI AGS grade passback.
 * @param {object} ltiIdToken - Reconstructed idtoken (from getLtiIdToken or stored lti_grade_context)
 * @param {number} score - Score to publish
 * @param {string} [comment] - Optional comment
 * @param {number} [scoreMaximum=100] - Max score — must match the lineItem's scoreMaximum
 * @returns {object} Result from lti.Grade.scorePublish
 */
async function publishGrade(ltiIdToken, score, comment, scoreMaximum = 100) {
  const grade = {
    scoreGiven: score,
    scoreMaximum,
    activityProgress: 'Completed',
    gradingProgress: 'FullyGraded',
    comment: comment || 'Your simulation has been evaluated. To view detailed feedback including per-criterion scores and specific comments, open this assignment and select your completed attempt.',
  };

  return lti.Grade.scorePublish(ltiIdToken, grade);
}

/**
 * Rebuild the decoded-ltik shape that getLtiIdToken expects from a stored
 * lti_grade_context snapshot. Lets retry paths re-read a FRESH token from the
 * ltijs tables when the stored snapshot has gone stale.
 */
function decodedLtikFromContext(ctx) {
  if (!ctx) return null;
  return {
    platformUrl: ctx.iss,
    clientId: ctx.clientId,
    deploymentId: ctx.deploymentId,
    contextId: ctx.platformContext?.contextId,
    user: ctx.user,
  };
}

/**
 * Best-effort token reconstruction when a session has no stored
 * lti_grade_context at all: derive (iss, clientId, contextId, user) from the
 * session's joins and take the most recent matching ltijs idtoken regardless
 * of deploymentId. Returns null when nothing usable exists.
 */
async function getLtiIdTokenForSession(sessionId) {
  const { rows } = await pool.query(
    `SELECT u.lti_user_id, p.url AS platform_url, p.client_id, a.lti_context_id
     FROM simulation_sessions s
     JOIN users u ON s.user_id = u.id
     JOIN assignments a ON s.assignment_id = a.id
     JOIN lti_platforms p ON s.platform_id = p.id
     WHERE s.id = $1`,
    [sessionId]
  );
  if (rows.length === 0) return null;
  const { lti_user_id, platform_url, client_id, lti_context_id } = rows[0];

  const idtokenResult = await pool.query(
    `SELECT * FROM idtokens
     WHERE iss = $1 AND "clientId" = $2 AND "user" = $3
     ORDER BY "updatedAt" DESC LIMIT 1`,
    [platform_url, client_id, lti_user_id]
  );
  if (idtokenResult.rows.length === 0) return null;
  const idtoken = idtokenResult.rows[0];

  return getLtiIdToken({
    platformUrl: platform_url,
    clientId: client_id,
    deploymentId: idtoken.deploymentId,
    contextId: lti_context_id,
    user: lti_user_id,
  });
}

module.exports = { getLtiIdToken, publishGrade, decodedLtikFromContext, getLtiIdTokenForSession };
