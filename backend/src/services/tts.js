const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');

// Text-to-speech via Amazon Polly (voice mode, Plan 07 phase B).
//
// Fail-safe: the IAM user may lack polly:SynthesizeSpeech (see Runbooks →
// "Voice output"). The first AccessDenied disables TTS for the process
// lifetime so we don't hammer a permanently-denied API; a restart re-probes.

let client = null;
let unavailable = false;

function getClient() {
  if (!client) {
    client = new PollyClient({ region: process.env.AWS_BEDROCK_REGION || 'us-east-2' });
  }
  return client;
}

function isTtsAvailable() {
  return !unavailable;
}

/** Synthesize text → mp3 Buffer, or null when unavailable/failed. */
async function synthesize(text, voiceId = 'Joanna') {
  if (unavailable || !text?.trim()) return null;
  try {
    const response = await getClient().send(new SynthesizeSpeechCommand({
      Text: text,
      OutputFormat: 'mp3',
      VoiceId: voiceId,
      Engine: 'neural',
    }));
    const chunks = [];
    for await (const chunk of response.AudioStream) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch (err) {
    if (err.name === 'AccessDeniedException') {
      unavailable = true;
      console.warn('[tts] Polly access denied — voice output disabled until the IAM policy is added (see Runbooks) and the service restarts');
    } else {
      console.error('[tts] synthesis failed:', err.message);
    }
    return null;
  }
}

module.exports = { synthesize, isTtsAvailable };
