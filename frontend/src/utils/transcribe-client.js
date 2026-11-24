// Browser client for the voice-input WebSocket (Amazon Transcribe streaming
// relay — backend/src/ws/voice-ws.js has the protocol and handshake rules).
//
// mic (getUserMedia) → AudioWorklet (16kHz Int16 PCM, public/pcm-worklet.js)
// → binary WS frames → server relays to Transcribe → transcript events back.
//
// Start-latency matters: words spoken before the capture graph is running are
// lost. When mic permission is already granted the WS connects in parallel
// with mic + worklet setup; audio frames buffer client-side until the server
// says `ready`. (With permission still undecided the WS waits for the grant —
// otherwise the server would open a Transcribe stream that sits silent while
// the user stares at the permission prompt.)
//
// Error contract for ChatInterface's fallback tree:
//   - MicDeniedError: user refused the mic — do NOT fall back to Web Speech
//     (it needs the mic too); show a hint instead.
//   - TranscribeUnavailableError: the streaming path is down (no ready in
//     time, quota, server error) — fall back to Web Speech if available.
//

import { getLTIToken, getStoredToken } from './lti'

export class MicDeniedError extends Error {
  constructor() {
    super('microphone permission denied')
    this.name = 'MicDeniedError'
  }
}

export class TranscribeUnavailableError extends Error {
  constructor(code) {
    super(`transcribe stream unavailable (${code})`)
    this.name = 'TranscribeUnavailableError'
    this.code = code
  }
}

const READY_TIMEOUT_MS = 3000

function voiceWsUrl(sessionId) {
  const base = window.location
  const proto = base.protocol === 'http:' ? 'ws:' : 'wss:'
  const params = new URLSearchParams({
    ltik: getStoredToken() || getLTIToken() || '',
    sessionId,
  })
  return `${proto}//${base.host}/api/voice/ws?${params}`
}

async function micPermissionGranted() {
  try {
    const st = await navigator.permissions.query({ name: 'microphone' })
    return st.state === 'granted'
  } catch {
    return false // Permissions API unavailable (Safari) — be conservative
  }
}

/**
 * Start a voice capture + transcription stream for the given session.
 * Resolves (mic capturing + server `ready`) to { stop() }. Rejects with
 * MicDeniedError or TranscribeUnavailableError before any transcript arrives.
 */
export async function startTranscribeStream({
  sessionId,
  onTranscript = () => {},
  onEnd = () => {},
  onError = () => {},
}) {
  const parallel = await micPermissionGranted()

  let ws = null
  let wsEarly = [] // messages that arrive before the protocol handler installs
  const openWs = () => {
    ws = new WebSocket(voiceWsUrl(sessionId))
    ws.binaryType = 'arraybuffer'
    ws.onmessage = (e) => wsEarly.push(e.data)
  }
  if (parallel) openWs()

  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    })
  } catch {
    if (ws) { try { ws.close(1000) } catch {} }
    throw new MicDeniedError()
  }
  if (!parallel) openWs()

  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  let closed = false

  const cleanup = () => {
    if (closed) return
    closed = true
    try { stream.getTracks().forEach((t) => t.stop()) } catch {}
    try { ctx.close() } catch {}
    if (ws && ws.readyState <= WebSocket.OPEN) {
      try { ws.close(1000) } catch {}
    }
  }

  try {
    await ctx.audioWorklet.addModule('/pcm-worklet.js')
  } catch (e) {
    cleanup()
    throw new TranscribeUnavailableError('worklet')
  }

  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'pcm-downsampler')
  source.connect(node)

  return new Promise((resolve, reject) => {
    let ready = false
    let ended = false
    const pending = [] // audio frames buffered until the server relay is up

    const fail = (code) => {
      cleanup()
      const err = new TranscribeUnavailableError(code)
      if (ready) onError(err)
      else reject(err)
    }

    const readyTimer = setTimeout(() => fail('timeout'), READY_TIMEOUT_MS)

    node.port.onmessage = (e) => {
      if (closed) return
      if (ready && ws.readyState === WebSocket.OPEN) ws.send(e.data)
      else if (pending.length < 100) pending.push(e.data)
    }

    const handleMessage = (data) => {
      let msg
      try { msg = JSON.parse(data) } catch { return }
      if (msg.type === 'ready') {
        ready = true
        clearTimeout(readyTimer)
        for (const f of pending) ws.send(f)
        pending.length = 0
        resolve({
          stop() {
            if (ws.readyState === WebSocket.OPEN) {
              try { ws.send(JSON.stringify({ type: 'stop' })) } catch {}
            }
            // Server answers with trailing finals + end frame + close 1000;
            // stop capturing now either way.
            try { stream.getTracks().forEach((t) => t.stop()) } catch {}
          },
        })
      } else if (msg.type === 'transcript') {
        onTranscript(msg)
      } else if (msg.type === 'end') {
        ended = true
        cleanup()
        onEnd(msg.reason)
      } else if (msg.type === 'error') {
        clearTimeout(readyTimer)
        fail(msg.code)
      }
    }

    ws.onmessage = (e) => handleMessage(e.data)
    for (const data of wsEarly) handleMessage(data)
    wsEarly = []

    ws.onerror = () => {
      if (!ended && !closed) { clearTimeout(readyTimer); fail('network') }
    }
    ws.onclose = (e) => {
      clearTimeout(readyTimer)
      if (ended || closed) return
      if (e.code === 1000) { cleanup(); onEnd('server_close') }
      else fail(e.code || 'network')
    }
  })
}
