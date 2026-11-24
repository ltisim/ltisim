const { resolveLaunch } = require('../utils/launch');
const { URL } = require('url');
const { WebSocketServer } = require('ws');
const pool = require('../config/database');
const { createRelay, isTranscribeAvailable } = require('../services/transcribe-relay');
const { getReadyVocabularyName } = require('../services/transcribe-vocab');
const { checkAiQuota } = require('../utils/ai-quota');
const { logAiUsage } = require('../utils/ai-usage');

// Voice-input WebSocket: /api/voice/ws?ltik=…&sessionId=…
//
// Browser AudioWorklet streams Int16 16kHz PCM frames; we relay them to
// Amazon Transcribe streaming (services/transcribe-relay.js) and send partial
// transcripts back. See docs/Runbooks.md → "Voice input" for the protocol.
//
// Handshake (all checks before any audio reaches AWS):
//   1. ltik JWT verify + platform lookup — the same auth as middleware/auth.js,
//      inlined because WS upgrades don't pass through Express middleware.
//   2. Session ownership + assignment voice_config.enabled (single query).
//   3. Instance AI quota (checkAiQuota — voice rides the same budgets as
//      chat via the synthetic 'aws.transcribe-streaming' ai_models row).
//   4. Per-session voice cap: SUM(prompt_tokens) of call_type='voice' rows,
//      where 1 prompt token = 1 second of audio (see migrate-v22).
//
// Close codes: 1000 ok · 4001 auth · 4003 forbidden · 4029 quota/cap ·
// 4500 transcribe failure/overflow · 1011 unexpected.

const MODEL_ID = 'aws.transcribe-streaming';

function sessionMaxSeconds() {
  return parseInt(process.env.VOICE_SESSION_MAX_SECONDS, 10) || 1800;
}

function attachVoiceWs(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const path = req.url.split('?')[0];
    if (path !== '/api/voice/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', async (ws, req) => {
    const send = (obj) => {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify(obj)); } catch {}
      }
    };
    const reject = (code, logMsg) => {
      console.warn(`[voice-ws] reject: ${logMsg}`);
      send({ type: 'error', code });
      ws.close(code);
    };

    let context;
    try {
      context = await authorize(req);
    } catch (err) {
      return reject(err.wsCode || 1011, err.message);
    }

    if (!isTranscribeAvailable()) return reject(4500, 'transcribe unavailable');

    const { platformId, session, remainingSeconds, vocabularyName } = context;

    // Buffer client audio that arrives before the Transcribe stream is up —
    // the client also buffers until `ready`, this is just belt-and-braces.
    let settled = false;

    const relay = createRelay({
      vocabularyName,
      maxSeconds: Math.min(
        parseInt(process.env.VOICE_STREAM_MAX_SECONDS, 10) || 300,
        remainingSeconds
      ),
      onReady: () => send({ type: 'ready' }),
      onTranscript: (t) => send({ type: 'transcript', ...t }),
      onEnd: (reason) => {
        send({ type: 'end', reason });
        ws.close(1000);
      },
      onError: (code) => {
        send({ type: 'error', code });
        ws.close(4500);
      },
    });

    function settle() {
      if (settled) return;
      settled = true;
      const seconds = Math.ceil(relay.secondsStreamed());
      if (seconds > 0) {
        logAiUsage({
          platform_id: platformId,
          assignment_id: session.assignment_id,
          session_id: session.id,
          model_id: MODEL_ID,
          call_type: 'voice',
          usage: { inputTokens: seconds, outputTokens: 0 },
        });
      }
    }

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        relay.pushAudio(data);
        return;
      }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg?.type === 'stop') relay.stop('client_stop');
    });

    ws.on('close', () => {
      relay.stop('client_stop');
      settle();
    });
    ws.on('error', () => {
      relay.stop('client_stop');
      settle();
    });
  });

  console.log('[voice-ws] voice WebSocket attached at /api/voice/ws');
  return wss;
}

// Throws Error with .wsCode on any failed check.
async function authorize(req) {
  const fail = (wsCode, message) => {
    const err = new Error(message);
    err.wsCode = wsCode;
    return err;
  };

  const query = new URL(req.url, 'http://localhost').searchParams;
  const ltik = query.get('ltik');
  const sessionId = parseInt(query.get('sessionId'), 10);
  if (!ltik || !sessionId) throw fail(4001, 'missing ltik or sessionId');

  let decoded, platformId;
  try {
    ({ decoded, platformId } = await resolveLaunch(ltik));
  } catch (err) {
    throw fail(4001, err.status ? err.message : 'invalid ltik');
  }

  const { rows } = await pool.query(
    `SELECT s.id, s.assignment_id, s.status,
            a.voice_config, a.transcribe_vocab
       FROM simulation_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN assignments a ON a.id = s.assignment_id
      WHERE s.id = $1 AND s.platform_id = $2 AND u.lti_user_id = $3`,
    [sessionId, platformId, decoded.user]
  );
  const session = rows[0];
  if (!session) throw fail(4003, `session ${sessionId} not owned by user/platform`);
  if (session.status !== 'in_progress') throw fail(4003, `session ${sessionId} is ${session.status}`);
  if (session.voice_config?.enabled !== true) {
    throw fail(4003, `voice disabled on assignment ${session.assignment_id}`);
  }

  const quota = await checkAiQuota();
  if (!quota.allowed) throw fail(4029, `AI quota: ${quota.reason || 'exhausted'}`);

  const used = await pool.query(
    `SELECT COALESCE(SUM(prompt_tokens), 0) AS seconds FROM ai_usage
      WHERE session_id = $1 AND call_type = 'voice'`,
    [sessionId]
  );
  const remainingSeconds = sessionMaxSeconds() - Number(used.rows[0].seconds);
  if (remainingSeconds <= 0) throw fail(4029, `session ${sessionId} voice cap reached`);

  const vocabularyName = await getReadyVocabularyName(
    session.assignment_id,
    session.transcribe_vocab
  );

  return { platformId, session, remainingSeconds, vocabularyName };
}

module.exports = { attachVoiceWs };
