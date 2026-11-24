const {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} = require('@aws-sdk/client-transcribe-streaming');

// Voice input via Amazon Transcribe streaming (see docs/Runbooks.md → "Voice input").
//
// Relay core: the WS layer (ws/voice-ws.js) feeds raw Int16 16kHz mono PCM
// frames in via pushAudio(); this module streams them to Transcribe and calls
// back with accumulated transcript text. It has NO ws/express dependencies so
// it can be reused outside the WebSocket server.
//
// Fail-safe: mirrors tts.js — the IAM user may lack transcribe:StartStream-
// Transcription; the first AccessDenied disables the relay for the process
// lifetime (clients fall back to Web Speech). A restart re-probes.
//
// Accounting: audio seconds = bytes / 32000 (16,000 samples/s × 2 bytes).

let client = null;
let unavailable = false;

const BYTES_PER_SECOND = 32000;
const MAX_QUEUED_FRAMES = 100; // ~10s of 100ms frames; beyond this the consumer is stuck
const DRAIN_TIMEOUT_MS = 3000; // max wait for trailing finals after a graceful stop

function getClient() {
  if (!client) {
    client = new TranscribeStreamingClient({
      region: process.env.AWS_BEDROCK_REGION || 'us-east-2',
      ...(process.env.AWS_ACCESS_KEY_ID && {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      }),
    });
  }
  return client;
}

function isTranscribeAvailable() {
  return !unavailable;
}

// Rebuild display text from result Items (Transcribe's per-word tokens),
// splitting on Item.Stable so the UI can render settled vs. still-changing
// words differently. Punctuation attaches to the preceding word.
function joinItems(items) {
  let out = '';
  for (const item of items) {
    if (item.Type === 'punctuation') out += item.Content;
    else out += (out ? ' ' : '') + item.Content;
  }
  return out;
}

function splitStable(result) {
  const alt = result.Alternatives?.[0];
  if (!alt) return { stable: '', unstable: '' };
  const items = alt.Items || [];
  if (!result.IsPartial || items.length === 0) {
    return { stable: alt.Transcript || '', unstable: '' };
  }
  const stableItems = [];
  const unstableItems = [];
  for (const item of items) {
    (item.Stable === false ? unstableItems : stableItems).push(item);
  }
  return { stable: joinItems(stableItems), unstable: joinItems(unstableItems) };
}

/**
 * Start a relay session.
 *
 * opts:
 *   vocabularyName  – Transcribe custom vocabulary to bias with (or null)
 *   maxSeconds      – hard cap on streamed audio for this session
 *   idleSeconds     – auto-stop after this long without new transcript text
 *   onReady()       – Transcribe stream established; audio is flowing
 *   onTranscript({ final, stable, unstable, endTime })
 *   onEnd(reason)   – exactly once: client_stop | idle | max_duration | <caller reasons>
 *   onError(code)   – 'unavailable' | 'overflow' | 'transcribe_error'; onEnd is NOT called after
 *
 * returns { pushAudio(buffer), stop(reason), secondsStreamed() }
 *
 * stop() (and the idle/max-duration auto-stops) end the audio stream but keep
 * the transcript stream open briefly so trailing final results — the speaker's
 * last words — still arrive before onEnd fires.
 */
function createRelay(opts) {
  const {
    vocabularyName = null,
    maxSeconds = parseInt(process.env.VOICE_STREAM_MAX_SECONDS, 10) || 300,
    idleSeconds = parseInt(process.env.VOICE_IDLE_SECONDS, 10) || 15,
    onReady = () => {},
    onTranscript = () => {},
    onEnd = () => {},
    onError = () => {},
  } = opts;

  let bytesReceived = 0;
  let committed = ''; // finalized segments, server-accumulated
  let lastEmitted = '';
  let done = false; // terminal: onEnd/onError has fired
  let stopping = false; // graceful stop requested; draining trailing finals
  let endReason = null;
  let idleTimer = null;
  let drainTimer = null;

  // Bounded async queue: pushAudio() produces, the AudioStream generator consumes.
  const queue = [];
  let wakeConsumer = null;

  function finish(kind, arg) {
    if (done) return;
    done = true;
    stopping = true;
    clearTimeout(idleTimer);
    clearTimeout(drainTimer);
    closeAudio();
    if (kind === 'error') onError(arg);
    else onEnd(arg);
  }

  // End the audio generator; Transcribe then finalizes and closes the
  // transcript stream, which lets run() drain remaining results.
  function closeAudio() {
    queue.length = 0;
    queue.push(null);
    if (wakeConsumer) wakeConsumer();
  }

  function gracefulStop(reason) {
    if (done || stopping) return;
    stopping = true;
    endReason = reason;
    clearTimeout(idleTimer);
    closeAudio();
    drainTimer = setTimeout(() => finish('end', reason), DRAIN_TIMEOUT_MS);
  }

  function resetIdle() {
    if (stopping) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => gracefulStop('idle'), idleSeconds * 1000);
  }

  async function* audioStream() {
    while (true) {
      if (queue.length === 0) {
        await new Promise((resolve) => { wakeConsumer = resolve; });
        wakeConsumer = null;
      }
      const chunk = queue.shift();
      if (chunk === null || chunk === undefined) return;
      yield { AudioEvent: { AudioChunk: chunk } };
    }
  }

  async function run() {
    try {
      // IMPORTANT: send() does not resolve until audio is flowing (the audio
      // generator IS the request body), so `ready` must NOT wait for it —
      // otherwise client-buffers-until-ready deadlocks against the SDK and
      // Transcribe kills the session after 15s of silence. Signal ready now;
      // the queue absorbs audio while the stream establishes (~1s).
      setImmediate(() => {
        if (!done) {
          onReady();
          resetIdle();
        }
      });
      const response = await getClient().send(new StartStreamTranscriptionCommand({
        LanguageCode: 'en-US',
        MediaEncoding: 'pcm',
        MediaSampleRateHertz: 16000,
        EnablePartialResultsStabilization: true,
        PartialResultsStability: 'high',
        ...(vocabularyName && { VocabularyName: vocabularyName }),
        AudioStream: audioStream(),
      }));

      for await (const event of response.TranscriptResultStream) {
        if (done) break;
        const results = event.TranscriptEvent?.Transcript?.Results || [];
        for (const result of results) {
          const { stable, unstable } = splitStable(result);
          const sep = committed && stable ? ' ' : '';
          const payload = {
            final: !result.IsPartial,
            stable: committed + sep + stable,
            unstable,
            endTime: result.EndTime,
          };
          if (!result.IsPartial) {
            committed = payload.stable;
          }
          const emitted = payload.stable + ' ' + payload.unstable;
          if (emitted !== lastEmitted) {
            lastEmitted = emitted;
            resetIdle();
            onTranscript(payload);
          }
        }
      }
      // Transcript stream drained (normal close after the audio generator ended).
      finish('end', endReason || 'client_stop');
    } catch (err) {
      if (err.name === 'AccessDeniedException') {
        unavailable = true;
        console.warn('[transcribe] access denied — voice streaming disabled until the IAM policy is added (see Runbooks) and the service restarts');
        finish('error', 'unavailable');
      } else if (!done) {
        console.error('[transcribe] stream failed:', err.name, err.message);
        finish('error', 'transcribe_error');
      }
    }
  }

  if (unavailable) {
    // Surface asynchronously so callers can wire handlers before it fires.
    setImmediate(() => finish('error', 'unavailable'));
  } else {
    run();
  }

  return {
    pushAudio(buffer) {
      if (done || stopping) return;
      bytesReceived += buffer.length;
      if (bytesReceived / BYTES_PER_SECOND >= maxSeconds) {
        gracefulStop('max_duration');
        return;
      }
      if (queue.length >= MAX_QUEUED_FRAMES) {
        finish('error', 'overflow');
        return;
      }
      queue.push(buffer);
      if (wakeConsumer) wakeConsumer();
    },
    stop(reason = 'client_stop') {
      gracefulStop(reason);
    },
    secondsStreamed() {
      return bytesReceived / BYTES_PER_SECOND;
    },
  };
}

module.exports = { createRelay, isTranscribeAvailable };
