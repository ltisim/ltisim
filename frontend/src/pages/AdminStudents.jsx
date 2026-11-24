import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminAPI } from '../utils/api'
import AdminNav from '../components/AdminNav'
import { formatDate } from '../utils/format'
import { Users, ChevronDown, ChevronRight, Eye } from 'lucide-react'

// Course roster: every enrolled student × every assignment, with drill-in to
// each student's sessions (route: /admin/students).
function AdminStudents({ user }) {
  const navigate = useNavigate()
  const [roster, setRoster] = useState(null)
  const [course, setCourse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    const load = async () => {
      try {
        const [rosterRes, courseRes] = await Promise.all([
          adminAPI.getRoster(),
          adminAPI.getCourse(),
        ])
        setRoster(rosterRes.data)
        setCourse(courseRes.data.course)
        setError(null)
      } catch (err) {
        console.error('Error loading roster:', err)
        setError('Failed to load the course roster. Please try again.')
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
        <p className="mt-4 text-gray-500">Loading roster...</p>
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

  const assignments = roster.assignments.filter((a) => a.is_published !== false)
  const sessionsByStudent = new Map()
  for (const s of roster.sessions) {
    const list = sessionsByStudent.get(s.user_id) || []
    list.push(s)
    sessionsByStudent.set(s.user_id, list)
  }

  const cellFor = (userId, assignmentId) => {
    const sessions = (sessionsByStudent.get(userId) || []).filter((s) => s.assignment_id === assignmentId)
    if (sessions.length === 0) {
      return <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-400">Not started</span>
    }
    const inProgress = sessions.some((s) => s.status === 'in_progress')
    const completed = sessions.filter((s) => s.status === 'completed')
    const pending = completed.filter((s) => s.review_status === 'pending_review').length
    const latest = completed[completed.length - 1]
    if (completed.length === 0 && inProgress) {
      return <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-primary-100 text-primary-700">In progress</span>
    }
    return (
      <span className="inline-flex items-center gap-1 flex-wrap">
        <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">
          {completed.length}× done{latest?.score != null ? ` · ${latest.score}` : ''}
        </span>
        {pending > 0 && (
          <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">{pending} pending</span>
        )}
        {inProgress && (
          <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-primary-100 text-primary-700">resumed</span>
        )}
      </span>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      <AdminNav course={course} user={user} />

      <div className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-5">
        <div>
          <h3 className="text-2xl font-bold text-surface-dark">Students</h3>
          <p className="text-xs text-gray-500 mt-1">
            {roster.students.length} enrolled student{roster.students.length === 1 ? '' : 's'} ·
            {' '}{assignments.length} published assignment{assignments.length === 1 ? '' : 's'}.
            Scores shown are the latest completed attempt. Click a row for a student's full history.
          </p>
        </div>

        {roster.students.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm py-16 text-center">
            <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No students yet</p>
            <p className="text-gray-400 text-sm mt-1">Students appear here after their first launch from the LMS.</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="bg-surface-darker text-white">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Student</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Last access</th>
                    {assignments.map((a) => (
                      <th key={a.id} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider max-w-[180px] truncate" title={a.title}>
                        {a.title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {roster.students.map((student) => {
                    const isOpen = expanded === student.user_id
                    const studentSessions = (sessionsByStudent.get(student.user_id) || [])
                    return (
                      <React.Fragment key={student.user_id}>
                        <tr
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => setExpanded(isOpen ? null : student.user_id)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                              <div>
                                <div className="font-semibold text-surface-dark text-sm">{student.name}</div>
                                <div className="text-xs text-gray-400">{student.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{formatDate(student.last_access)}</td>
                          {assignments.map((a) => (
                            <td key={a.id} className="px-4 py-3">{cellFor(student.user_id, a.id)}</td>
                          ))}
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={2 + assignments.length} className="px-6 py-3 bg-gray-50">
                              {studentSessions.length === 0 ? (
                                <p className="text-sm text-gray-400">No sessions yet.</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {studentSessions.map((s) => {
                                    const a = roster.assignments.find((x) => x.id === s.assignment_id)
                                    return (
                                      <div key={s.id} className="flex items-center justify-between gap-3 text-sm bg-white rounded-lg px-3 py-2 border border-gray-100">
                                        <div className="flex items-center gap-3 min-w-0">
                                          <span className="font-medium text-gray-700 truncate">{a?.title || `Assignment ${s.assignment_id}`}</span>
                                          <span className={`px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${
                                            s.review_status === 'pending_review' ? 'bg-amber-100 text-amber-700'
                                              : s.status === 'completed' ? 'bg-green-100 text-green-700'
                                              : 'bg-primary-100 text-primary-700'
                                          }`}>
                                            {s.review_status === 'pending_review' ? 'Pending review'
                                              : s.status === 'in_progress' ? 'In progress' : 'Completed'}
                                          </span>
                                          {s.score != null && <span className="text-gray-500 whitespace-nowrap">score {s.score}</span>}
                                          <span className="text-xs text-gray-400 whitespace-nowrap">{formatDate(s.completed_at || s.started_at)}</span>
                                        </div>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); navigate(`/admin/sessions/${s.id}`) }}
                                          className="px-2.5 py-1 bg-primary-500 text-white rounded-md text-xs font-medium hover:bg-primary-600 transition-colors inline-flex items-center gap-1 flex-shrink-0"
                                        >
                                          <Eye className="w-3 h-3" />
                                          View
                                        </button>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminStudents
