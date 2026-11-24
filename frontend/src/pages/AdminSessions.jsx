import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { adminAPI } from '../utils/api'
import { useToast } from '../components/Toast'
import AdminNav from '../components/AdminNav'
import ConfirmModal from '../components/ConfirmModal'
import { formatDate } from '../utils/format'
import { downloadResultsCsv } from '../utils/download'
import { Inbox, CheckSquare, ArrowLeft, Trash2, Eye, AlertTriangle, BarChart3, Download } from 'lucide-react'

// Sessions table for one assignment (route: /admin/assignments/:assignmentId/sessions)
function AdminSessions({ user }) {
  const navigate = useNavigate()
  const { assignmentId } = useParams()
  const { showToast } = useToast()
  const [assignment, setAssignment] = useState(null)
  const [sessions, setSessions] = useState([])
  const [course, setCourse] = useState(null)
  const [agreement, setAgreement] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [releasingAll, setReleasingAll] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    loadData()
  }, [assignmentId])

  const loadData = async () => {
    try {
      setLoading(true)
      const [assignmentsResponse, sessionsResponse, courseResponse] = await Promise.all([
        adminAPI.getAssignments(),
        adminAPI.getSessions(),
        adminAPI.getCourse(),
      ])
      const found = assignmentsResponse.data.assignments.find((a) => String(a.id) === String(assignmentId))
      if (!found) {
        setError('Assignment not found.')
        return
      }
      setAssignment(found)
      setSessions(sessionsResponse.data.sessions.filter((s) => String(s.assignment_id) === String(assignmentId)))
      setCourse(courseResponse.data.course)
      setError(null)
    } catch (err) {
      console.error('Error loading sessions:', err)
      setError('Failed to load sessions. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setAgreement(null)
    adminAPI.getAgreement(assignmentId)
      .then((res) => setAgreement(res.data))
      .catch(() => {})
  }, [assignmentId])

  const handleConfirmDelete = async () => {
    try {
      setDeleting(true)
      await adminAPI.deleteAssignment(assignment.id)
      showToast('Assignment deleted', 'success')
      navigate('/admin')
    } catch (err) {
      console.error('Error deleting assignment:', err)
      showToast('Failed to delete assignment', 'error')
    } finally {
      setDeleting(false)
      setDeleteModalOpen(false)
    }
  }

  const handleReleaseAllPending = async () => {
    const pendingCount = sessions.filter((s) => s.review_status === 'pending_review').length
    if (!confirm(`Release all ${pendingCount} pending-review sessions to students and submit their grades to Canvas? This cannot be undone.`)) {
      return
    }
    try {
      setReleasingAll(true)
      const res = await adminAPI.releasePending(assignment.id)
      const { succeeded, failed, passback } = res.data
      let msg = `Released ${succeeded} session${succeeded === 1 ? '' : 's'}`
      if (passback?.queued > 0) msg += ` (${passback.queued} grade${passback.queued === 1 ? '' : 's'} queued for passback retry)`
      if (failed > 0) msg += `; ${failed} failed`
      showToast(msg, failed > 0 ? 'warning' : 'success')
      loadData()
    } catch (err) {
      console.error('Error releasing pending sessions:', err)
      showToast(err.response?.data?.error || 'Failed to release pending sessions', 'error')
    } finally {
      setReleasingAll(false)
    }
  }

  const handleExport = async () => {
    try {
      setExporting(true)
      await downloadResultsCsv(assignment.id, assignment.title)
    } catch (err) {
      console.error('Error exporting CSV:', err)
      showToast('Failed to export results', 'error')
    } finally {
      setExporting(false)
    }
  }

  const getFilteredSessions = () => {
    if (filter === 'all') return sessions
    if (filter === 'pending_review') return sessions.filter((s) => s.review_status === 'pending_review')
    return sessions.filter((s) => s.status === filter)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-100 items-center justify-center">
        <div className="loading-spinner" />
        <p className="mt-4 text-gray-500">Loading sessions...</p>
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

  const filteredSessions = getFilteredSessions()
  const pendingHere = sessions.filter((s) => s.review_status === 'pending_review').length

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      <AdminNav course={course} user={user} pendingCount={pendingHere} />

      <div className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-5">
        <div className="space-y-3">
          <button
            className="text-primary-500 font-semibold text-sm hover:text-surface-dark transition-colors inline-flex items-center gap-1"
            onClick={() => navigate('/admin')}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Assignments
          </button>
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div>
              <h3 className="text-2xl font-bold text-surface-dark">{assignment.title} - Sessions</h3>
              {agreement?.summary?.pairs > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  AI matched your blind grading on {agreement.summary.level_matches} of {agreement.summary.pairs} criteria
                  {' '}({((agreement.summary.level_matches / agreement.summary.pairs) * 100).toFixed(0)}% level agreement
                  {agreement.summary.score_mae != null && <>, avg score gap {agreement.summary.score_mae} pts</>})
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => navigate(`/admin/assignments/${assignment.id}/analytics`)}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors flex items-center gap-1.5"
              >
                <BarChart3 className="w-4 h-4" />
                Analytics
              </button>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                {exporting ? 'Exporting…' : 'Export CSV'}
              </button>
              {pendingHere > 0 && (
                <button
                  onClick={handleReleaseAllPending}
                  disabled={releasingAll}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  <CheckSquare className="w-4 h-4" />
                  {releasingAll ? 'Releasing...' : 'Release All Pending'}
                </button>
              )}
              <button
                onClick={() => setDeleteModalOpen(true)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-800 transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                Delete Assignment
              </button>
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 bg-white p-1.5 rounded-lg shadow-sm flex-wrap">
          {[
            { key: 'all', label: `All Sessions (${sessions.length})` },
            { key: 'in_progress', label: `In Progress (${sessions.filter((s) => s.status === 'in_progress').length})` },
            { key: 'pending_review', label: `Pending Review (${pendingHere})` },
            { key: 'completed', label: `Completed (${sessions.filter((s) => s.status === 'completed').length})` },
          ].map((tab) => (
            <button
              key={tab.key}
              className={`flex-1 py-2.5 px-4 rounded-md text-sm font-medium transition-colors ${
                filter === tab.key ? 'bg-primary-500 text-white' : 'text-gray-500 hover:bg-gray-100'
              }`}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Sessions Table */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {filteredSessions.length === 0 ? (
            <div className="py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <Inbox className="w-8 h-8 text-gray-300" />
              </div>
              <p className="text-gray-500 text-sm">No sessions found for this assignment.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead>
                  <tr className="bg-surface-darker text-white">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Student</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Started</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Completed</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Score</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider">Messages</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider">Feedback</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredSessions.map((session) => (
                    <tr key={session.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-surface-dark text-sm">{session.student_name}</div>
                        <div className="text-xs text-gray-400">{session.student_email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block whitespace-nowrap px-3 py-1 rounded-full text-xs font-semibold ${
                          session.review_status === 'pending_review'
                            ? 'bg-amber-500 text-white'
                            : session.review_status === 'released'
                            ? 'bg-green-600 text-white'
                            : session.status === 'completed'
                            ? 'bg-success text-white'
                            : 'bg-primary-500 text-white'
                        }`}>
                          {session.review_status === 'pending_review' ? 'Pending Review'
                            : session.review_status === 'released' ? 'Released'
                            : session.status === 'in_progress' ? 'In Progress'
                            : 'Completed'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatDate(session.started_at)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatDate(session.completed_at)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          {session.score !== null ? (
                            <span className="font-bold text-success">{session.score}%</span>
                          ) : (
                            <span className="text-gray-300 italic">N/A</span>
                          )}
                          {['failed', 'failed_permanent', 'pending_retry', 'retrying'].includes(session.grade_passback_status) && (
                            <span title={session.grade_passback_status === 'pending_retry' || session.grade_passback_status === 'retrying'
                              ? 'Grade passback failed — automatic retry scheduled'
                              : 'Grade passback failed — open the session to retry'}>
                              <AlertTriangle className="w-4 h-4 text-amber-500" />
                            </span>
                          )}
                          {session.evaluation_status && (
                            <span title={session.evaluation_status === 'failed_permanent'
                              ? 'AI evaluation failed — open the session to regrade or grade manually'
                              : 'AI evaluation failed — automatic retry scheduled'}>
                              <AlertTriangle className={`w-4 h-4 ${session.evaluation_status === 'failed_permanent' ? 'text-red-500' : 'text-blue-500'}`} />
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-gray-600">{session.interaction_count || 0}</td>
                      <td className="px-4 py-3 text-center">
                        {session.feedback_count > 0 ? (
                          <span className="inline-block bg-primary-500 text-white px-2 py-0.5 rounded-full text-xs font-semibold">
                            {session.feedback_count}
                          </span>
                        ) : (
                          <span className="text-gray-300">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => navigate(`/admin/sessions/${session.id}`)}
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
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={deleteModalOpen}
        title="Delete Assignment"
        message={`Are you sure you want to delete "${assignment?.title}"? This will also delete all ${assignment?.session_count || 0} session(s) associated with this assignment. This action cannot be undone.`}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteModalOpen(false)}
        confirmText={deleting ? 'Deleting...' : 'Delete'}
        cancelText="Cancel"
        confirmDanger={true}
      />
    </div>
  )
}

export default AdminSessions
