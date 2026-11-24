import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { simulationAPI } from '../utils/api'
import { BookOpen, Inbox, Play, RotateCcw, Clock, Trophy, Eye, UserCircle, Sparkles } from 'lucide-react'

function StudentDashboard({ ltik, user }) {
  const [assignments, setAssignments] = useState([])
  const [sessions, setSessions] = useState([])
  const [courseName, setCourseName] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [assignmentsRes, sessionsRes] = await Promise.all([
        simulationAPI.getAssignments(),
        simulationAPI.getMySessions(),
      ])
      setAssignments(assignmentsRes.data.assignments)
      setSessions(sessionsRes.data.sessions)
      if (assignmentsRes.data.courseName) {
        setCourseName(assignmentsRes.data.courseName)
      }
      setError(null)
    } catch (err) {
      console.error('Error loading dashboard:', err)
      setError('Failed to load assignments. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleStartAssignment = (assignmentId, practice = false) => {
    navigate(`/simulation?assignmentId=${assignmentId}${practice ? '&practice=1' : ''}`)
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A'
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const formatDateTime = (dateString) => {
    if (!dateString) return 'N/A'
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Build a map of assignment_id -> sessions for that assignment
  const sessionsByAssignment = {}
  sessions.forEach((s) => {
    if (!sessionsByAssignment[s.assignment_id]) {
      sessionsByAssignment[s.assignment_id] = []
    }
    sessionsByAssignment[s.assignment_id].push(s)
  })

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-100 items-center justify-center">
        <div className="loading-spinner" />
        <p className="mt-4 text-gray-500">Loading assignments...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-100 items-center justify-center p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg px-6 py-4 text-red-700 text-center">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      <header className="bg-surface-darker text-white py-6 px-8 shadow-md">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BookOpen className="w-6 h-6" />
          {courseName || 'My Assignments'}
        </h1>
        {user && <p className="text-sm text-white/80 mt-1">Welcome, {user.name}!</p>}
      </header>

      <div className="flex-1 max-w-7xl w-full mx-auto p-6">
        {assignments.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <Inbox className="w-8 h-8 text-gray-300" />
            </div>
            <h2 className="text-xl font-semibold text-gray-500 mb-2">No assignments available</h2>
            <p className="text-gray-400 text-sm">There are currently no simulation assignments in this course. Please check back later or contact your instructor.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {assignments.map((assignment) => {
              const assignmentSessions = sessionsByAssignment[assignment.id] || []
              const inProgress = assignmentSessions.find((s) => s.status === 'in_progress')
              // Practice sessions never count as attempts or appear in history
              const completed = assignmentSessions.filter((s) => s.status === 'completed' && !s.is_practice)
              const pendingReview = completed.filter((s) => s.review_status === 'pending_review')
              const released = completed.filter((s) => s.review_status !== 'pending_review')
              const latestCompleted = released[0] // already sorted by started_at DESC
              const maxSessions = assignment.max_sessions
              const completedCount = completed.length
              const atLimit = maxSessions != null && completedCount >= maxSessions && !inProgress

              const isLLM = assignment.assignment_type === 'llm_interaction'
              const headerGradient = isLLM ? 'from-teal-500 to-teal-700' : 'from-primary-500 to-surface-dark'
              const buttonGradient = isLLM ? 'from-teal-500 to-teal-700' : 'from-primary-500 to-surface-dark'
              const hoverBorder = isLLM ? 'hover:border-teal-500' : 'hover:border-primary-500'
              return (
                <div
                  key={assignment.id}
                  className={`bg-white rounded-xl shadow-md border-2 border-transparent ${hoverBorder} hover:-translate-y-1 transition-all overflow-hidden flex flex-col`}
                >
                  <div className={`p-5 text-white bg-gradient-to-br ${headerGradient}`}>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-lg">{assignment.title}</h3>
                      <span className="px-2 py-0.5 bg-white/20 text-white rounded-full text-xs font-semibold inline-flex items-center gap-1 flex-shrink-0">
                        {assignment.assignment_type === 'llm_interaction'
                          ? <><Sparkles className="w-3 h-3" /> LLM</>
                          : <><UserCircle className="w-3 h-3" /> Sim</>
                        }
                      </span>
                    </div>
                    <span className="text-sm text-white/80 mt-1 block">
                      Created: {formatDate(assignment.created_at)}
                    </span>
                  </div>
                  <div className="p-5 flex-1 flex flex-col">
                    <p className="text-gray-500 text-sm leading-relaxed line-clamp-5">
                      {assignment.description || 'No description provided'}
                    </p>

                  </div>
                  <div className="px-5 pb-5 mt-auto space-y-3">
                    {/* Session status badges */}
                    {(inProgress || latestCompleted || pendingReview.length > 0) && (
                      <div className="space-y-2">
                        {inProgress && (
                          <div className="flex items-center gap-2 text-sm text-primary-600 bg-primary-50 rounded-lg px-3 py-2">
                            <Clock className="w-4 h-4 flex-shrink-0" />
                            <span>Current session in progress since {formatDateTime(inProgress.started_at)}</span>
                          </div>
                        )}
                        {pendingReview.length === 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              navigate(`/simulation?sessionId=${pendingReview[0].id}`)
                            }}
                            className="w-full flex items-center gap-2 text-sm text-blue-700 bg-blue-50 rounded-lg px-3 py-2 hover:bg-blue-100 transition-colors text-left"
                          >
                            <Clock className="w-4 h-4 flex-shrink-0" />
                            <span>1 attempt awaiting review</span>
                            <span className="ml-auto flex items-center gap-1 text-xs text-blue-500">
                              <Eye className="w-3.5 h-3.5" />
                              View
                            </span>
                          </button>
                        )}
                        {pendingReview.length > 1 && (
                          <div className="space-y-1.5">
                            {pendingReview.map((s, i) => (
                              <button
                                key={s.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  navigate(`/simulation?sessionId=${s.id}`)
                                }}
                                className="w-full flex items-center gap-2 text-sm text-blue-700 bg-blue-50 rounded-lg px-3 py-2 hover:bg-blue-100 transition-colors text-left"
                              >
                                <Clock className="w-4 h-4 flex-shrink-0" />
                                <span>Attempt {i + 1} · Awaiting review</span>
                                <span className="ml-auto flex items-center gap-1 text-xs text-blue-500">
                                  <Eye className="w-3.5 h-3.5" />
                                  View
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {released.length === 1 && latestCompleted && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              navigate(`/simulation?sessionId=${latestCompleted.id}`)
                            }}
                            className="w-full flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2 hover:bg-green-100 transition-colors text-left"
                          >
                            <Trophy className="w-4 h-4 flex-shrink-0" />
                            <span>
                              {latestCompleted.scoring_enabled !== false
                                ? `Completed: ${latestCompleted.score}%`
                                : 'Completed'}
                            </span>
                            <span className="ml-auto flex items-center gap-1 text-xs text-green-500">
                              <Eye className="w-3.5 h-3.5" />
                              View
                            </span>
                          </button>
                        )}
                        {released.length > 1 && (
                          <div className="space-y-1.5">
                            {[...released].reverse().map((s, i) => (
                              <button
                                key={s.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  navigate(`/simulation?sessionId=${s.id}`)
                                }}
                                className="w-full flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2 hover:bg-green-100 transition-colors text-left"
                              >
                                <Trophy className="w-4 h-4 flex-shrink-0" />
                                <span>
                                  Attempt {i + 1} · {formatDate(s.completed_at)}
                                  {s.scoring_enabled !== false ? ` · ${s.score}%` : ''}
                                </span>
                                <span className="ml-auto flex items-center gap-1 text-xs text-green-500">
                                  <Eye className="w-3.5 h-3.5" />
                                  View
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {maxSessions != null && (
                      <div className={`text-xs font-medium px-3 py-1.5 rounded-lg ${
                        atLimit
                          ? 'text-red-600 bg-red-50'
                          : 'text-gray-500 bg-gray-50'
                      }`}>
                        {atLimit
                          ? 'No attempts remaining'
                          : `Attempt ${completedCount + 1} of ${maxSessions}`}
                      </div>
                    )}
                    {(() => {
                      // Score trend across released attempts, oldest → newest
                      const trend = [...released].reverse().map((s) => s.score).filter((v) => v != null)
                      return trend.length >= 2 ? (
                        <div className="text-xs font-medium px-3 py-1.5 rounded-lg text-gray-500 bg-gray-50">
                          Your scores: {trend.join(' → ')}
                          {Number(trend[trend.length - 1]) > Number(trend[0]) && <span className="text-green-600"> ▲</span>}
                        </div>
                      ) : null
                    })()}
                    {inProgress ? (
                      <button
                        className={`w-full py-3 bg-gradient-to-br ${buttonGradient} text-white rounded-lg font-semibold hover:-translate-y-0.5 hover:shadow-lg transition-all flex items-center justify-center gap-2`}
                        onClick={() => handleStartAssignment(assignment.id)}
                      >
                        <RotateCcw className="w-4 h-4" />
                        Resume
                      </button>
                    ) : atLimit ? (
                      <button
                        disabled
                        className="w-full py-3 bg-gray-300 text-gray-500 rounded-lg font-semibold cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        No Attempts Remaining
                      </button>
                    ) : (
                      <button
                        className={`w-full py-3 bg-gradient-to-br ${buttonGradient} text-white rounded-lg font-semibold hover:-translate-y-0.5 hover:shadow-lg transition-all flex items-center justify-center gap-2`}
                        onClick={() => handleStartAssignment(assignment.id)}
                      >
                        {completed.length > 0 ? (
                          <>
                            <RotateCcw className="w-4 h-4" />
                            Retry
                          </>
                        ) : (
                          <>
                            <Play className="w-4 h-4" />
                            Start
                          </>
                        )}
                      </button>
                    )}
                    {assignment.allow_practice && !inProgress && (
                      <button
                        className="w-full py-2 border-2 border-purple-200 text-purple-700 rounded-lg text-sm font-semibold hover:bg-purple-50 transition-colors"
                        onClick={() => handleStartAssignment(assignment.id, true)}
                        title="A short ungraded run with AI feedback. Doesn't use an attempt; nothing goes to the gradebook."
                      >
                        Practice first (not graded)
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default StudentDashboard
