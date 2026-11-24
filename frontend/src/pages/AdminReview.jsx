import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminAPI } from '../utils/api'
import AdminNav from '../components/AdminNav'
import { formatDate } from '../utils/format'
import { Inbox, Eye, AlertTriangle } from 'lucide-react'

const QUEUE_KEY = 'ltisim_review_queue'

const SORTS = {
  oldest: { label: 'Oldest first', fn: (a, b) => new Date(a.completed_at || 0) - new Date(b.completed_at || 0) },
  newest: { label: 'Newest first', fn: (a, b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0) },
  score_asc: { label: 'Lowest score first', fn: (a, b) => (a.score ?? -1) - (b.score ?? -1) },
  score_desc: { label: 'Highest score first', fn: (a, b) => (b.score ?? -1) - (a.score ?? -1) },
}

// Cross-assignment review queue (route: /admin/review). Opening a session
// stores the current queue order so the detail page can offer prev/next (j/k).
function AdminReview({ user }) {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState([])
  const [course, setCourse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sort, setSort] = useState('oldest')
  const [assignmentFilter, setAssignmentFilter] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const [sessionsRes, courseRes] = await Promise.all([
          adminAPI.getSessions(),
          adminAPI.getCourse(),
        ])
        setSessions(sessionsRes.data.sessions.filter((s) => s.review_status === 'pending_review'))
        setCourse(courseRes.data.course)
        setError(null)
      } catch (err) {
        console.error('Error loading review queue:', err)
        setError('Failed to load the review queue. Please try again.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-100 items-center justify-center">
        <div className="loading-spinner" />
        <p className="mt-4 text-gray-500">Loading review queue...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-100 items-center justify-center p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg px-6 py-4 text-red-700 text-center">{error}</div>
      </div>
    )
  }

  const assignmentTitles = [...new Set(sessions.map((s) => s.assignment_title))].sort()
  const visible = sessions
    .filter((s) => !assignmentFilter || s.assignment_title === assignmentFilter)
    .sort(SORTS[sort].fn)

  const openSession = (session) => {
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(visible.map((s) => s.id)))
    navigate(`/admin/sessions/${session.id}`)
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      <AdminNav course={course} user={user} pendingCount={sessions.length} />

      <div className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-5">
        <div className="flex justify-between items-end flex-wrap gap-3">
          <div>
            <h3 className="text-2xl font-bold text-surface-dark">Review Queue</h3>
            <p className="text-xs text-gray-500 mt-1">
              All sessions awaiting your review, across every assignment. Open one and use <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[10px]">j</kbd>/<kbd className="px-1 py-0.5 bg-gray-200 rounded text-[10px]">k</kbd> to move through the queue.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={assignmentFilter}
              onChange={(e) => setAssignmentFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 bg-white focus:border-primary-500 focus:outline-none"
            >
              <option value="">All assignments</option>
              {assignmentTitles.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 bg-white focus:border-primary-500 focus:outline-none"
            >
              {Object.entries(SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
            </select>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm py-16 text-center">
            <Inbox className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Nothing waiting for review</p>
            <p className="text-gray-400 text-sm mt-1">Sessions from review-mode assignments land here when students complete them.</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="bg-surface-darker text-white">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Student</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Assignment</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Completed</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Draft score</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visible.map((session, i) => (
                    <tr key={session.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openSession(session)}>
                      <td className="px-4 py-3 text-sm text-gray-400">{i + 1}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-surface-dark text-sm">{session.student_name}</div>
                        <div className="text-xs text-gray-400">{session.student_email}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{session.assignment_title}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatDate(session.completed_at)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          {session.score !== null ? (
                            <span className="font-bold text-gray-700">{session.score}</span>
                          ) : (
                            <span className="text-gray-300 italic">—</span>
                          )}
                          {session.evaluation_status && (
                            <span title={session.evaluation_status === 'failed_permanent'
                              ? 'AI evaluation failed — regrade or grade manually'
                              : 'AI evaluation failed — automatic retry scheduled'}>
                              <AlertTriangle className={`w-4 h-4 ${session.evaluation_status === 'failed_permanent' ? 'text-red-500' : 'text-blue-500'}`} />
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={(e) => { e.stopPropagation(); openSession(session) }}
                          className="px-3 py-1.5 bg-primary-500 text-white rounded-md text-xs font-medium hover:bg-primary-600 transition-colors inline-flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminReview
