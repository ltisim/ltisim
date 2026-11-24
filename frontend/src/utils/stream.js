import { getStoredToken } from './lti'

// SSE-over-POST reader for the streaming chat endpoints. Axios can't stream
// response bodies in the browser, so this uses fetch + ReadableStream.
// Frames are `data: {json}\n\n`: `{delta}` per chunk, then a final `{done,…}`
// payload (returned), or `{error}` (thrown, err.midStream = true).
export async function streamPost(path, body, onDelta) {
  const token = getStoredToken()
  const sep = path.includes('?') ? '&' : '?'
  const response = await fetch(`${path}${sep}stream=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'x-lti-token': token }),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    // Pre-stream validation failures (limits, quota, 404) are plain JSON
    let data = null
    try { data = await response.json() } catch { /* non-JSON error body */ }
    const err = new Error(data?.error || `Request failed (${response.status})`)
    err.response = { status: response.status, data }
    throw err
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let final = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const line = frame.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      let payload
      try { payload = JSON.parse(line.slice(6)) } catch { continue }
      if (payload.error) {
        const err = new Error(payload.error)
        err.midStream = true
        throw err
      }
      if (payload.delta) {
        onDelta?.(payload.delta)
      } else if (payload.done) {
        final = payload
      }
    }
  }

  if (!final) {
    const err = new Error('The response stream ended unexpectedly')
    err.midStream = true
    throw err
  }
  return final
}
