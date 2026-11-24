import React, { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { simulationAPI } from '../utils/api'
import { useToast } from '../components/Toast'
import ChatInterface from '../components/ChatInterface'
import {
  ArrowLeft, BookOpen, X, CheckCircle, Loader2, Trophy, Sparkles,
  AlertTriangle, Clock, ClipboardList, PanelLeftOpen, PanelLeftClose, Play,
} from 'lucide-react'

function LLMInteractionPage({ ltik, user: initialUser }) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { showToast } = useToast()

  const [user, setUser] = useState(initialUser || null)
  const [session, setSession] = useState(null)
  const [assignment, setAssignment] = useState(null)
  const [interactions, setInteractions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isTyping, setIsTyping] = useState(false)
  const [submittingGrade, setSubmittingGrade] = useState(false)
  const [evaluation, setEvaluation] = useState(null)
  const [canComplete, setCanComplete] = useState(false)
  const [maxReached, setMaxReached] = useState(false)
  const [minMessages, setMinMessages] = useState(null)
  // Desktop panel: 'collapsed' (rail) | 'expanded' (60vw)
  const [panelMode, setPanelMode] = useState('expanded')
  // Mobile-only overlay panel
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false)
  const [showBriefing, setShowBriefing] = useState(false)

  useEffect(() => {
    initializeSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ltik])

  const initializeSession = async () => {
    try {
      setLoading(true)

      if (!user) {
        const userResponse = await simulationAPI.getUser()
        setUser(userResponse.data.user)
      }

      const assignmentId = searchParams.get('assignmentId')
      const viewSessionId = searchParams.get('sessionId')

      if (viewSessionId) {
        const sessionResponse = await simulationAPI.getSession(viewSessionId)
        const existingSession = sessionResponse.data.session
        setSession(existingSession)

        const interactionsResponse = await simulationAPI.getInteractions(viewSessionId)
        setInteractions(interactionsResponse.data.interactions)

        if (existingSession.status === 'completed' && existingSession.ai_evaluation && existingSession.review_status !== 'pending_review') {
          setEvaluation({
            score: existingSession.score,
            criteria_evaluations: existingSession.score_breakdown?.criteria_evaluations || [],
            overall_feedback: existingSession.ai_evaluation?.overall_feedback || '',
            fallback: existingSession.ai_evaluation?.fallback || false,
            scoring_enabled: existingSession.ai_evaluation?.scoring_enabled !== false,
          })
        }

        if (existingSession.assignment_id) {
          try {
            const assignmentResponse = await simulationAPI.getAssignment(existingSession.assignment_id)
            setAssignment(assignmentResponse.data.assignment)
          } catch (e) {}
        }
      } else {
        const sessionResponse = await simulationAPI.createSession(assignmentId, searchParams.get('practice') === '1')
        const newSession = sessionResponse.data.session
        setSession(newSession)

        const interactionsResponse = await simulationAPI.getInteractions(newSession.id)
        const loadedInteractions = interactionsResponse.data.interactions
        setInteractions(loadedInteractions)

        let loadedAssignment = null
        if (assignmentId) {
          try {
            const assignmentResponse = await simulationAPI.getAssignment(assignmentId)
            loadedAssignment = assignmentResponse.data.assignment
            setAssignment(loadedAssignment)
          } catch (e) {}
        }

        const userMessageCount = loadedInteractions.filter((i) => i.role === 'user').length
        const minMsgs = loadedAssignment?.completion_conditions?.min_messages
        if (minMsgs && userMessageCount < minMsgs) {
          setCanComplete(false)
          setMinMessages(minMsgs)
        } else if (userMessageCount > 0) {
          setCanComplete(true)
        }

        // Show briefing for new sessions only (no user messages yet); skip on resume
        const hasUserMessages = userMessageCount > 0
        setShowBriefing(!hasUserMessages && newSession.status !== 'completed')
      }

      setLoading(false)
    } catch (err) {
      console.error('Error initializing LLM interaction:', err)
      if (err.response?.status === 403 && err.response?.data?.error === 'Session limit reached') {
        const { max_sessions } = err.response.data
        showToast(`You've used all ${max_sessions} attempt${max_sessions === 1 ? '' : 's'} for this assignment.`, 'info')
        navigate('/')
        return
      }
      setError('Failed to initialize activity. Please try again.')
      setLoading(false)
    }
  }

  const handleSendMessage = async (message) => {
    if (!session) return

    try {
      const tempUserMsg = {
        id: `temp_${Date.now()}`,
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      }
      setInteractions((prev) => [...prev, tempUserMsg])
      setIsTyping(true)

      // Stream the AI reply: a placeholder assistant message grows per chunk,
      // then both temp messages are swapped for the server-final rows.
      const tempAiId = `temp_ai_${Date.now()}`
      const final = await simulationAPI.chatStream(session.id, message, (delta) => {
        setIsTyping(false)
        setInteractions((prev) => {
          const idx = prev.findIndex((i) => i.id === tempAiId)
          if (idx === -1) {
            return [...prev, { id: tempAiId, role: 'assistant', content: delta, timestamp: new Date().toISOString() }]
          }
          const copy = [...prev]
          copy[idx] = { ...copy[idx], content: copy[idx].content + delta }
          return copy
        })
      })
      const { userInteraction, aiInteraction, completionStatus } = final

      setInteractions((prev) => {
        const withoutTemp = prev.filter((i) => i.id !== tempUserMsg.id && i.id !== tempAiId)
        return [...withoutTemp, userInteraction, aiInteraction]
      })

      if (completionStatus) {
        setCanComplete(completionStatus.canComplete !== false)
        if (completionStatus.minMessages) {
          setMinMessages(completionStatus.minMessages)
        }
      }

      if (completionStatus?.maxReached) {
        setMaxReached(true)
        if (completionStatus.reason === 'auto_complete') {
          showToast('Maximum messages reached. Evaluating your work...', 'info')
          setTimeout(() => handleComplete(), 500)
        } else {
          showToast('Maximum messages reached. Please complete the activity.', 'info')
        }
      } else if (completionStatus?.effectiveMax
        && completionStatus.effectiveMax - completionStatus.userMessageCount === 1) {
        showToast('One message remaining before the limit — make it count.', 'info')
      }
    } catch (err) {
      console.error('Error sending message:', err)
      setInteractions((prev) => prev.filter((i) => !String(i.id).startsWith('temp_')))
      if (err.response?.data?.maxReached) {
        setMaxReached(true)
        showToast('Message limit reached. Please complete the activity.', 'info')
      } else {
        showToast('Failed to send message. Please try again.', 'error')
      }
    } finally {
      setIsTyping(false)
    }
  }

  const handleComplete = async () => {
    if (!session) return

    try {
      setSubmittingGrade(true)
      const response = await simulationAPI.evaluateAndComplete(session.id)
      const { session: updatedSession, evaluation: evalResult, gradeSubmission, pendingReview, evaluationPending } = response.data

      setSession(updatedSession)

      if (pendingReview) {
        showToast(evaluationPending
          ? 'Activity submitted! Your work is being evaluated — check back shortly.'
          : 'Activity submitted! Your instructor will review your work.', 'success')
      } else {
        setEvaluation(evalResult)
        const scoringEnabled = evalResult.scoring_enabled !== false
        if (updatedSession?.is_practice) {
          showToast('Practice complete! Feedback is below — nothing was sent to the gradebook.', 'success')
        } else if (gradeSubmission?.success) {
          if (scoringEnabled) {
            showToast(`Activity completed! Score: ${evalResult.score}%`, 'success')
          } else {
            showToast('Activity completed! Completion credit recorded.', 'success')
          }
        } else {
          showToast('Activity completed, but there was an issue submitting your grade.', 'warning')
        }
      }
    } catch (err) {
      console.error('Error completing activity:', err)
      showToast('Failed to complete activity. Please try again.', 'error')
    } finally {
      setSubmittingGrade(false)
    }
  }

  const scoringEnabled = assignment?.scoring_enabled !== false
  const hasCriteria = assignment?.criteria && assignment.criteria.length > 0
  const isCompleted = session?.status === 'completed'
  const isPendingReview = session?.review_status === 'pending_review'
  const hasUserMessages = interactions.some((i) => i.role === 'user')
  const completeDisabled = submittingGrade || !hasUserMessages || !canComplete
  const learningHtml = assignment?.learning_content?.html || ''
  const learningTitle = assignment?.learning_content?.title || 'Lesson'

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <div className="w-16 h-16 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
        <p className="mt-4 text-gray-500 animate-pulse-soft">Loading activity...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg px-6 py-4 text-red-700 text-center">{error}</div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="bg-surface-darker text-white py-4 px-6 shadow-md flex-shrink-0 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={() => navigate('/')}
            className="text-white/80 hover:text-white font-medium text-sm inline-flex items-center gap-1 flex-shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold flex items-center gap-2 truncate">
              <Sparkles className="w-5 h-5 flex-shrink-0" />
              {assignment?.title || 'LLM Interaction'}
            </h1>
            {user && <p className="text-sm text-white/80 mt-0.5 truncate">Welcome, {user.name}</p>}
          </div>
        </div>
        {learningHtml && (
          <button
            onClick={() => setMobilePanelOpen(true)}
            className="lg:hidden px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-semibold inline-flex items-center gap-2 flex-shrink-0"
          >
            <BookOpen className="w-4 h-4" />
            Lesson
          </button>
        )}
      </header>

      {showBriefing ? (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto p-5 flex flex-col gap-5 py-8">
            {assignment?.description && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800 mb-3">
                  <Sparkles className="w-5 h-5 text-primary-500" />
                  About this Activity
                </h2>
                <p className="text-gray-600 leading-relaxed whitespace-pre-line">{assignment.description}</p>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-3">How it works</h2>
              <ul className="space-y-3 text-gray-600 text-sm">
                {learningHtml && (
                  <li className="flex items-start gap-2">
                    <span className="text-primary-500 mt-0.5">&#8226;</span>
                    <span>
                      The <strong>Tasks</strong> panel on the left contains your lesson and what you're being asked to do. It's open by default — read through it before you start chatting.
                    </span>
                  </li>
                )}
                {learningHtml && (
                  <li className="flex items-start gap-2">
                    <span className="text-primary-500 mt-0.5">&#8226;</span>
                    <span>
                      You can <strong>collapse</strong> the panel any time using the <PanelLeftClose className="w-4 h-4 inline text-gray-500 -mt-0.5" /> button in its header to give the chat more room. To bring it back, click the <strong>Tasks</strong> tab on the left edge of the screen.
                    </span>
                  </li>
                )}
                <li className="flex items-start gap-2">
                  <span className="text-primary-500 mt-0.5">&#8226;</span>
                  <span>
                    Chat with the AI in the main area. It's a general-purpose assistant — there's no character or role-play. Experiment with different messages as you work through the lesson.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary-500 mt-0.5">&#8226;</span>
                  <span>
                    When you're ready to finish, click <strong>Complete Activity</strong>. {scoringEnabled && hasCriteria
                      ? "Your conversation will be evaluated against the tasks listed below."
                      : "You'll receive completion credit for this assignment."}
                  </span>
                </li>
              </ul>
            </div>

            {scoringEnabled && hasCriteria && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800 mb-3">
                  <ClipboardList className="w-5 h-5 text-primary-500" />
                  What you'll be evaluated on
                </h2>
                <div className="space-y-3">
                  {assignment.criteria.map((criterion) => (
                    <div key={criterion.id} className="border-l-2 border-primary-200 pl-4">
                      <p className="font-medium text-gray-700">{criterion.title}</p>
                      {criterion.description && (
                        <p className="text-sm text-gray-500 mt-0.5">{criterion.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-center pt-2">
              <button
                onClick={() => setShowBriefing(false)}
                className="px-10 py-3.5 bg-primary-500 text-white rounded-xl text-lg font-semibold hover:bg-primary-600 transition-colors flex items-center gap-2 shadow-md"
              >
                <Play className="w-5 h-5" />
                Begin Activity
              </button>
            </div>
          </div>
        </div>
      ) : isCompleted && (isPendingReview || ['pending_evaluation', 'evaluating'].includes(session?.evaluation_status)) ? (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto p-5">
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-8 text-center">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center mx-auto mb-4 shadow-lg">
                <Clock className="w-10 h-10 text-white" />
              </div>
              {['pending_evaluation', 'evaluating'].includes(session?.evaluation_status) ? (
                <>
                  <h2 className="text-2xl font-bold text-blue-800 mb-2">Evaluation in Progress</h2>
                  <p className="text-blue-600 mt-2 leading-relaxed max-w-md mx-auto">
                    Your work has been submitted and is being evaluated — check back in a few minutes
                    to see your feedback.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-bold text-blue-800 mb-2">Submitted for Review</h2>
                  <p className="text-blue-600 mt-2 leading-relaxed max-w-md mx-auto">
                    Your work has been submitted. Your instructor will review it and release your feedback and score.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      ) : isCompleted ? (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto p-5">
            <div className="bg-gradient-to-br from-green-50 to-teal-50 border border-green-200 rounded-xl p-8 text-center animate-scale-in">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center mx-auto mb-4 shadow-lg animate-bounce-in">
                <Trophy className="w-10 h-10 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-green-800 mb-2">Activity Completed!</h2>

              {scoringEnabled ? (
                <div className="w-28 h-28 rounded-full border-4 border-green-500 flex items-center justify-center mx-auto my-4">
                  <span className="text-2xl font-bold text-green-700">{session.score}%</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 bg-green-100 text-green-700 px-6 py-3 rounded-full my-4 text-lg font-semibold">
                  <CheckCircle className="w-6 h-6" />
                  Complete
                </div>
              )}

              {evaluation && (
                <div className="mt-6 text-left">
                  {evaluation.fallback && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-3 flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-amber-800 font-medium text-sm">Participation-based score</p>
                        <p className="text-amber-700 text-sm mt-0.5">
                          AI evaluation was unavailable. Your score is based on participation rather than tasks.
                        </p>
                      </div>
                    </div>
                  )}

                  {evaluation.overall_feedback && (
                    <div className="bg-white rounded-lg p-4 mb-3 shadow-sm">
                      <h3 className="font-semibold text-gray-700 mb-1 text-sm">Feedback</h3>
                      <p className="text-gray-600 text-sm leading-relaxed">{evaluation.overall_feedback}</p>
                    </div>
                  )}

                  {evaluation.criteria_evaluations && evaluation.criteria_evaluations.length > 0 && (
                    <div className="bg-white rounded-lg p-4 shadow-sm">
                      <h3 className="font-semibold text-gray-700 mb-3 text-sm flex items-center gap-1.5">
                        <ClipboardList className="w-4 h-4 text-primary-500" />
                        Task Evaluation
                      </h3>
                      <div className="space-y-3">
                        {evaluation.criteria_evaluations.map((c) => {
                          const criterion = assignment?.criteria?.find((cr) => cr.id === c.id)
                          const taskName = c.name || criterion?.title || c.id
                          const maxPts = criterion?.max_points || c.score
                          return (
                            <div key={c.id} className="border border-gray-100 rounded-lg p-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-gray-800 font-semibold text-sm">{taskName}</span>
                                {scoringEnabled && c.score !== undefined && maxPts > 0 && (
                                  <span className="font-semibold text-gray-800 text-sm">{c.score}/{maxPts}</span>
                                )}
                              </div>
                              {c.feedback && <p className="text-sm text-gray-600 leading-relaxed">{c.feedback}</p>}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <p className="text-green-600 text-sm mt-4">
                {scoringEnabled ? 'Your grade has been submitted to Canvas.' : 'Completion credit has been submitted to Canvas.'}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Desktop: left-docked lesson sidebar (Claude-style) */}
          {learningHtml && (
            <aside
              className={`hidden lg:flex flex-col bg-white border-r border-gray-200 flex-shrink-0 transition-[width] duration-200 ease-out ${
                panelMode === 'collapsed' ? 'w-32' : 'w-[60vw] max-w-[1100px]'
              }`}
            >
              {panelMode === 'collapsed' ? (
                <button
                  onClick={() => setPanelMode('expanded')}
                  title="Open Tasks"
                  className="flex items-center gap-2 px-4 py-3 text-gray-600 hover:text-primary-600 hover:bg-primary-50 transition-colors border-b border-gray-200"
                >
                  <PanelLeftOpen className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm font-semibold">Tasks</span>
                </button>
              ) : (
                <>
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 flex-shrink-0 gap-2">
                    <h2 className="font-semibold text-gray-800 flex items-center gap-2 truncate min-w-0">
                      <BookOpen className="w-5 h-5 text-primary-500 flex-shrink-0" />
                      <span className="truncate">{learningTitle}</span>
                    </h2>
                    <button
                      onClick={() => setPanelMode('collapsed')}
                      title="Collapse Tasks"
                      className="p-1.5 rounded hover:bg-gray-200 text-gray-500 flex-shrink-0"
                    >
                      <PanelLeftClose className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-6">
                    <div
                      className="prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: learningHtml }}
                    />
                  </div>
                </>
              )}
            </aside>
          )}

          <main className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 min-h-0 max-w-3xl w-full mx-auto px-4 py-4 flex flex-col gap-3">
              <div className="flex-1 min-h-0">
                <ChatInterface
                  interactions={interactions}
                  onSendMessage={handleSendMessage}
                  disabled={maxReached}
                  isTyping={isTyping}
                  personaName={null}
                />
              </div>

              <div className="flex justify-center flex-shrink-0">
                <div className="flex flex-col items-center gap-1">
                  <button
                    onClick={handleComplete}
                    disabled={completeDisabled}
                    className="px-8 py-3 bg-success text-white rounded-lg text-lg font-semibold hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                  >
                    {submittingGrade ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Evaluating...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-5 h-5" />
                        Complete Activity
                      </>
                    )}
                  </button>
                  {!canComplete && minMessages && (
                    <span className="text-xs text-gray-400">
                      Send at least {minMessages} messages before completing
                    </span>
                  )}
                </div>
              </div>
            </div>
          </main>

          {/* Mobile: full-screen overlay panel */}
          {learningHtml && mobilePanelOpen && (
            <>
              <div
                className="lg:hidden fixed inset-0 bg-black/30 z-30"
                onClick={() => setMobilePanelOpen(false)}
              />
              <aside className="lg:hidden fixed top-0 left-0 h-full w-full sm:w-[480px] max-w-full bg-white shadow-2xl z-40 flex flex-col animate-slide-in">
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50 flex-shrink-0">
                  <h2 className="font-semibold text-gray-800 flex items-center gap-2 truncate">
                    <BookOpen className="w-5 h-5 text-primary-500 flex-shrink-0" />
                    {learningTitle}
                  </h2>
                  <button
                    onClick={() => setMobilePanelOpen(false)}
                    className="p-1.5 rounded hover:bg-gray-200 text-gray-500 flex-shrink-0"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: learningHtml }}
                  />
                </div>
              </aside>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default LLMInteractionPage
