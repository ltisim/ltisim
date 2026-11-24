import { adminAPI } from './api'

// Download the per-assignment results CSV. Auth travels in the x-lti-token
// header, so a plain <a href> can't fetch it — pull the blob and click a
// temporary object URL instead.
export async function downloadResultsCsv(assignmentId, title) {
  const response = await adminAPI.exportResultsCsv(assignmentId)
  const url = URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${String(title || 'assignment').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60)}-results.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
