import React, { useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import StudentSessionDetail from '../components/StudentSessionDetail'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const QUEUE_KEY = 'ltisim_review_queue'

// Routed session detail (route: /admin/sessions/:sessionId). When the session
// was opened from the review queue, a floating prev/next bar (and j/k keys)
// walks the queue order stored by AdminReview.
function AdminSessionPage() {
  const navigate = useNavigate()
  const { sessionId } = useParams()

  let queue = []
  try {
    queue = JSON.parse(sessionStorage.getItem(QUEUE_KEY) || '[]')
  } catch { /* ignore corrupt state */ }
  const pos = queue.findIndex((id) => String(id) === String(sessionId))
  const prevId = pos > 0 ? queue[pos - 1] : null
  const nextId = pos >= 0 && pos < queue.length - 1 ? queue[pos + 1] : null

  const goTo = useCallback((id) => {
    if (id != null) navigate(`/admin/sessions/${id}`)
  }, [navigate])

  const handleClose = useCallback(() => {
    // -1 returns to whichever list opened this (sessions table, roster, queue);
    // on a direct deep link there is no in-app history, so fall back to /admin.
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1)
    } else {
      navigate('/admin')
    }
  }, [navigate])

  useEffect(() => {
    const onKey = (e) => {
      const target = e.target
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }
      if (e.key === 'j') goTo(nextId)
      if (e.key === 'k') goTo(prevId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nextId, prevId, goTo])

  return (
    <div className="relative">
      <StudentSessionDetail key={sessionId} sessionId={Number(sessionId)} onClose={handleClose} />

      {pos >= 0 && queue.length > 1 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-surface-darker text-white rounded-full shadow-lg px-3 py-2 flex items-center gap-3 z-40">
          <button
            onClick={() => goTo(prevId)}
            disabled={prevId == null}
            className="p-1 rounded-full hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Previous in queue (k)"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-white/80 whitespace-nowrap">Queue {pos + 1} of {queue.length}</span>
          <button
            onClick={() => goTo(nextId)}
            disabled={nextId == null}
            className="p-1 rounded-full hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Next in queue (j)"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}

export default AdminSessionPage
