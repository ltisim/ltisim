// Voice settings and live status, in one place.
//
// Voice does not go through the AI provider. Spoken input is Amazon Transcribe
// or the student's browser; spoken replies are Amazon Polly. This module
// decides which applies, so the server, the student page, the editor and the
// Instance area all say the same thing. See docs/Voice.md.
//
//   VOICE_MODE     auto (default) | aws | browser | off
//   VOICE_REPLIES  true (default) | false
//   AWS_VOICE_REGION, falling back to AWS_BEDROCK_REGION, AWS_REGION, us-east-1

const MODES = ['auto', 'aws', 'browser', 'off'];

// What has been learned about AWS since the process started. `credentials` is
// null until probed. A denied permission or bad credentials stays recorded
// until restart, so a broken setup is tried once, not on every request.
const state = { credentials: null, transcribeDenied: false, pollyDenied: false };

function mode() {
  const raw = String(process.env.VOICE_MODE || 'auto').trim().toLowerCase();
  return MODES.includes(raw) ? raw : 'auto';
}

function repliesWanted() {
  return String(process.env.VOICE_REPLIES || 'true').trim().toLowerCase() !== 'false';
}

function region() {
  return process.env.AWS_VOICE_REGION || process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1';
}

/** Options for any AWS client used by voice. */
function awsClientOptions() {
  return {
    region: region(),
    ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && {
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    }),
  };
}

function usesAws() {
  const m = mode();
  return m === 'auto' || m === 'aws';
}

const CREDENTIAL_ERRORS = new Set([
  'CredentialsProviderError', 'ExpiredTokenException', 'ExpiredToken',
  'UnrecognizedClientException', 'InvalidSignatureException', 'InvalidClientTokenId',
]);

/**
 * Record an AWS failure. Returns true when the error means the service will
 * keep failing (so callers can stop trying), false for a passing fault.
 */
function noteAwsError(service, err) {
  const name = err?.name || '';
  if (name === 'AccessDeniedException') {
    if (service === 'polly') state.pollyDenied = true;
    else state.transcribeDenied = true;
    console.warn(`[voice] ${service}: permission denied. Disabled until the permission is added and the app restarts (docs/Voice.md).`);
    return true;
  }
  if (CREDENTIAL_ERRORS.has(name)) {
    state.credentials = false;
    console.warn(`[voice] AWS credentials missing or rejected (${name}). Amazon voice services disabled until restart.`);
    return true;
  }
  return false;
}

/** Find out, without calling a paid service, whether AWS credentials exist. */
async function probe() {
  if (!usesAws()) {
    state.credentials = false;
    return status();
  }
  try {
    const { TranscribeStreamingClient } = require('@aws-sdk/client-transcribe-streaming');
    const client = new TranscribeStreamingClient(awsClientOptions());
    const lookup = client.config.credentials();
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 5000));
    const creds = await Promise.race([lookup, timeout]);
    state.credentials = !!creds?.accessKeyId;
  } catch {
    state.credentials = false;
  }
  return status();
}

/**
 * What voice does right now.
 *   input            'aws' | 'browser' | 'off'
 *   browser_fallback true when the browser may take over if Amazon fails
 *   replies          true when replies are read aloud (Amazon Polly)
 */
function status() {
  const m = mode();
  const awsReady = usesAws() && state.credentials !== false;
  const transcribe = awsReady && !state.transcribeDenied;
  let input;
  if (m === 'off') input = 'off';
  else if (m === 'browser') input = 'browser';
  else if (m === 'aws') input = transcribe ? 'aws' : 'off';
  else input = transcribe ? 'aws' : 'browser';
  return {
    mode: m,
    input,
    browser_fallback: m === 'auto' && input === 'aws',
    replies: awsReady && repliesWanted() && !state.pollyDenied,
  };
}

/** Status plus the reasons, for administrators. */
function describe() {
  const s = status();
  const notes = [];
  if (usesAws()) {
    if (state.credentials === false) notes.push('No usable AWS credentials were found.');
    if (state.transcribeDenied) notes.push('Amazon Transcribe refused permission.');
    if (state.pollyDenied) notes.push('Amazon Polly refused permission.');
    if (!repliesWanted()) notes.push('Spoken replies are switched off (VOICE_REPLIES=false).');
  }
  return { ...s, region: usesAws() ? region() : null, notes };
}

function summaryLine() {
  const s = status();
  const input = { aws: 'Amazon Transcribe', browser: "the student's browser", off: 'off' }[s.input];
  return `[voice] mode=${s.mode}; spoken input: ${input}${s.browser_fallback ? ' (browser if it fails)' : ''}; spoken replies: ${s.replies ? 'Amazon Polly' : 'off'}`;
}

// For tests.
function _reset(next = {}) {
  Object.assign(state, { credentials: null, transcribeDenied: false, pollyDenied: false }, next);
}

module.exports = {
  mode, region, awsClientOptions, usesAws, noteAwsError, probe, status, describe, summaryLine, _reset,
};
