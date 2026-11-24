const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const voice = require('./voice');

// Spoken replies via Amazon Polly (see docs/Voice.md).
//
// Whether replies are on at all is decided in services/voice.js. A denied
// permission or unusable credentials are recorded there and stop further
// attempts until restart.

const MODEL_ID = 'aws.polly-neural';

let client = null;

function getClient() {
  if (!client) client = new PollyClient(voice.awsClientOptions());
  return client;
}

function isTtsAvailable() {
  return voice.status().replies;
}

/** Synthesize text → mp3 Buffer, or null when unavailable/failed. */
async function synthesize(text, voiceId = 'Joanna') {
  if (!isTtsAvailable() || !text?.trim()) return null;
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
    if (!voice.noteAwsError('polly', err)) console.error('[tts] synthesis failed:', err.name, err.message);
    return null;
  }
}

module.exports = { synthesize, isTtsAvailable, MODEL_ID };
