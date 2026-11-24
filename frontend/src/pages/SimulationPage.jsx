import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { simulationAPI } from '../utils/api'
import { useToast } from '../components/Toast'
import ChatInterface from '../components/ChatInterface'
import SessionInfo from '../components/SessionInfo'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, ChevronUp, ChevronDown, ChevronRight, CheckCircle, Loader2, Trophy, ClipboardList, ArrowLeft, User, BookOpen, Play, AlertTriangle, Clock } from 'lucide-react'

function SimulationPage({ ltik, user: initialUser }) {
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
  const [prevAttempt, setPrevAttempt] = useState(null)
  const [currentStage, setCurrentStage] = useState(0)
  const [advancing, setAdvancing] = useState(false)
  const [phase, setPhase] = useState('chat') // chat | artifact
  const [artifactText, setArtifactText] = useState('')
  const [examinerStatus, setExaminerStatus] = useState(null)
  const [voiceMuted, setVoiceMuted] = useState(false)
  const ttsUnavailableRef = React.useRef(false)
  const audioRef = React.useRef(null)
  const [criteriaExpanded, setCriteriaExpanded] = useState(false)
  const [expandedCriteria, setExpandedCriteria] = useState({})
  const [showBriefing, setShowBriefing] = useState(false)

  useEffect(() => {
    initializeSession()
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
        // View a specific past session (read-only)
        const sessionResponse = await simulationAPI.getSession(viewSessionId)
        const existingSession = sessionResponse.data.session
        setSession(existingSession)

        const interactionsResponse = await simulationAPI.getInteractions(viewSessionId)
        setInteractions(interactionsResponse.data.interactions)

        // Reconstruct evaluation from stored data (skip if pending instructor review)
        if (existingSession.status === 'completed' && existingSession.ai_evaluation && existingSession.review_status !== 'pending_review') {
          setEvaluation({
            score: existingSession.score,
            criteria_evaluations: existingSession.score_breakdown?.criteria_evaluations || [],
            overall_feedback: existingSession.ai_evaluation?.overall_feedback || '',
            fallback: existingSession.ai_evaluation?.fallback || false,
            scoring_enabled: existingSession.ai_evaluation?.scoring_enabled !== false,
          })
        }

        // Load assignment details
        if (existingSession.assignment_id) {
          try {
            const assignmentResponse = await simulationAPI.getAssignment(existingSession.assignment_id)
            setAssignment(assignmentResponse.data.assignment)
          } catch (e) {
            // Non-critical
          }
        }

        // Viewing a past session — skip briefing
        setShowBriefing(false)
      } else {
        // Create / resume session (practice=1 starts an ungraded practice run)
        const wantsPractice = searchParams.get('practice') === '1'
        const sessionResponse = await simulationAPI.createSession(assignmentId, wantsPractice)
        const newSession = sessionResponse.data.session
        setSession(newSession)
        setCurrentStage(Number(newSession.data?.current_stage) || 0)
        if (Array.isArray(newSession.data?.covered_areas)) {
          setExaminerStatus({ covered: newSession.data.covered_areas })
        }

        // Previous released attempt: powers the briefing recap and the
        // per-criterion deltas on the completed screen.
        try {
          const mine = await simulationAPI.getMySessions()
          const prior = mine.data.sessions
            .filter((s) => String(s.assignment_id) === String(assignmentId)
              && s.id !== newSession.id && s.status === 'completed' && !s.is_practice
              && s.review_status !== 'pending_review'
              && s.score_breakdown?.criteria_evaluations?.length > 0)
            .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))[0]
          if (prior) setPrevAttempt(prior)
        } catch (e) {
          // Non-critical
        }

        // Load existing interactions
        const interactionsResponse = await simulationAPI.getInteractions(newSession.id)
        const loadedInteractions = interactionsResponse.data.interactions
        setInteractions(loadedInteractions)

        // Load student-safe assignment details
        let loadedAssignment = null
        if (assignmentId) {
          try {
            const assignmentResponse = await simulationAPI.getAssignment(assignmentId)
            loadedAssignment = assignmentResponse.data.assignment
            setAssignment(loadedAssignment)
          } catch (e) {
            // Non-critical: assignment details are optional
          }
        }

        // Check completion conditions against loaded interactions
        const userMessageCount = loadedInteractions.filter(i => i.role === 'user').length
        const minMsgs = loadedAssignment?.completion_conditions?.min_messages
        if (minMsgs && userMessageCount < minMsgs) {
          setCanComplete(false)
          setMinMessages(minMsgs)
        } else if (userMessageCount > 0) {
          setCanComplete(true)
        }

        // Show briefing for new sessions (no user messages yet), skip for resuming
        const hasUserMessages = userMessageCount > 0
        setShowBriefing(!hasUserMessages && newSession.status !== 'completed')
      }

      setLoading(false)
    } catch (err) {
      console.error('Error initializing session:', err)
      if (err.response?.status === 403 && err.response?.data?.error === 'Session limit reached') {
        const { max_sessions } = err.response.data
        showToast(`You've used all ${max_sessions} attempt${max_sessions === 1 ? '' : 's'} for this assignment. Review your past attempts from the dashboard.`, 'info')
        navigate('/')
        return
      } else {
        setError('Failed to initialize simulation. Please try again.')
      }
      setLoading(false)
    }
  }

  // Voice output: fetch the reply as speech and play it. Degrades silently —
  // the first 503 disables further attempts for this page load.
  const playReply = async (interaction) => {
    if (!assignment?.voice_config?.enabled || voiceMuted || ttsUnavailableRef.current) return
    try {
      const res = await simulationAPI.tts(session.id, interaction.id)
      const url = URL.createObjectURL(new Blob([res.data], { type: 'audio/mpeg' }))
      if (audioRef.current) {
        audioRef.current.pause()
        URL.revokeObjectURL(audioRef.current.src)
      }
      const audio = new Audio(url)
      audioRef.current = audio
      audio.play().catch(() => {})
    } catch (err) {
      if (err.response?.status === 503) ttsUnavailableRef.current = true
    }
  }

  useEffect(() => () => { audioRef.current?.pause() }, [])

  // Debounced autosave of the artifact draft while the student writes.
  // Must stay above the loading/error returns: hooks after a conditional
  // return crash with React #310 once the condition flips.
  useEffect(() => {
    if (phase !== 'artifact' || !session || session.status === 'completed') return
    const t = setTimeout(() => {
      simulationAPI.saveArtifactDraft(session.id, artifactText).catch(() => {})
    }, 3000)
    return () => clearTimeout(t)
  }, [artifactText, phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSendMessage = async (message, inputMode) => {
    if (!session) return

    try {
      // Optimistically add user message
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
      }, inputMode)
      const { userInteraction, aiInteraction, completionStatus } = final
      if (final.examinerStatus) setExaminerStatus(final.examinerStatus)
      playReply(aiInteraction)

      // Replace temp messages with real ones
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
          showToast('Maximum messages reached. Evaluating your simulation...', 'info')
          // Let state settle before triggering evaluation
          setTimeout(() => handleCompleteSimulation(), 500)
        } else {
          showToast('Maximum messages reached. Please complete the simulation.', 'info')
        }
      } else if (completionStatus?.effectiveMax
        && completionStatus.effectiveMax - completionStatus.userMessageCount === 1) {
        showToast('One message remaining before the limit — make it count.', 'info')
      }
    } catch (err) {
      console.error('Error sending message:', err)
      // Remove optimistic/streamed temp messages on failure
      setInteractions((prev) => prev.filter((i) => !String(i.id).startsWith('temp_')))
      if (err.response?.data?.maxReached) {
        setMaxReached(true)
        showToast('Message limit reached. Please complete the simulation.', 'info')
      } else {
        showToast('Failed to send message. Please try again.', 'error')
      }
    } finally {
      setIsTyping(false)
    }
  }

  const handleCompleteSimulation = async () => {
    if (!session) return

    try {
      setSubmittingGrade(true)

      const response = await simulationAPI.evaluateAndComplete(session.id, isArtifactType ? { artifact_text: artifactText } : undefined)
      const { session: updatedSession, evaluation: evalResult, gradeSubmission, pendingReview, evaluationPending } = response.data

      setSession(updatedSession)

      if (pendingReview) {
        showToast(evaluationPending
          ? 'Simulation submitted! Your work is being evaluated — check back shortly.'
          : 'Simulation submitted! Your instructor will review your work.', 'success')
      } else {
        setEvaluation(evalResult)

        const scoringEnabled = evalResult.scoring_enabled !== false

        if (updatedSession?.is_practice) {
          showToast('Practice complete! Feedback is below — nothing was sent to the gradebook.', 'success')
        } else if (gradeSubmission.success) {
          if (scoringEnabled) {
            showToast(`Simulation completed! Score: ${evalResult.score}%`, 'success')
          } else {
            showToast('Simulation completed! Completion credit recorded.', 'success')
          }
        } else {
          showToast('Simulation completed, but there was an issue submitting your grade.', 'warning')
        }
      }
    } catch (err) {
      console.error('Error completing simulation:', err)
      showToast(err.response?.data?.message || 'Failed to complete simulation. Please try again.', 'error')
    } finally {
      setSubmittingGrade(false)
    }
  }

  const scoringEnabled = assignment?.scoring_enabled !== false

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <MessageSquare className="w-6 h-6 text-primary-500" />
          </div>
        </div>
        <p className="mt-4 text-gray-500 animate-pulse-soft">Loading simulation...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg px-6 py-4 text-red-700 text-center">
          {error}
        </div>
      </div>
    )
  }

  const hasCriteria = assignment?.criteria && assignment.criteria.length > 0
  const isCompleted = session?.status === 'completed'
  const isPendingReview = session?.review_status === 'pending_review'
  const hasUserMessages = interactions.some((i) => i.role === 'user')
  const completeDisabled = submittingGrade || !hasUserMessages || !canComplete

  // Staged / artifact type helpers
  const stagesArr = Array.isArray(assignment?.stages) && assignment.stages.length > 0 ? assignment.stages : null
  const isStagedType = assignment?.assignment_type === 'staged_simulation' && !!stagesArr
  const isArtifactType = assignment?.assignment_type === 'simulation_with_artifact' && !!assignment?.artifact_config
  const onFinalStage = !isStagedType || currentStage >= stagesArr.length - 1
  const artifactWords = artifactText.trim() ? artifactText.trim().split(/\s+/).length : 0

  const handleAdvanceStage = async () => {
    try {
      setAdvancing(true)
      const res = await simulationAPI.advanceStage(session.id)
      setInteractions((prev) => [...prev, res.data.divider])
      setCurrentStage(res.data.current_stage)
      showToast(`Stage ${res.data.current_stage + 1}: ${res.data.stage.title}`, 'info')
    } catch (err) {
      showToast(err.response?.data?.message || err.response?.data?.error || 'Cannot advance yet', 'error')
    } finally {
      setAdvancing(false)
    }
  }

  const enterArtifactPhase = () => {
    if (!artifactText) {
      setArtifactText(session?.data?.artifact_draft || assignment?.artifact_config?.template_text || '')
    }
    setPhase('artifact')
  }

  // AI examiner: completion unlocks when every required area is covered (or
  // the message cap forces the escape hatch — the server enforces the same).
  const isExaminerType = assignment?.assignment_type === 'ai_examiner' && Array.isArray(assignment?.examiner_areas) && assignment.examiner_areas.length > 0
  const coveredAreas = new Set(examinerStatus?.covered || [])
  const examinerRemaining = isExaminerType
    ? assignment.examiner_areas.filter((a) => a.required && !coveredAreas.has(a.id)).length
    : 0
  const examinerComplete = isExaminerType && examinerRemaining === 0

  // The chat area's primary action depends on the type/stage
  const primaryAction = isStagedType && !onFinalStage
    ? handleAdvanceStage
    : isArtifactType
    ? enterArtifactPhase
    : handleCompleteSimulation
  const primaryDisabled = isStagedType && !onFinalStage
    ? advancing || !hasUserMessages
    : isExaminerType
    ? (submittingGrade || !hasUserMessages || (!examinerComplete && !maxReached))
    : completeDisabled
  const primaryLabel = isStagedType && !onFinalStage
    ? `Continue to Stage ${currentStage + 2}`
    : isArtifactType
    ? `Continue to ${assignment?.artifact_config?.title || 'Write-up'}`
    : isExaminerType
    ? (examinerComplete || maxReached ? 'Complete Session' : `${examinerRemaining} topic${examinerRemaining === 1 ? '' : 's'} remaining`)
    : 'Complete Simulation'

  const objectivesContent = (
    <div className="space-y-0.5">
      {isExaminerType && (
        <div className="mb-3 pb-3 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Topics</p>
          {assignment.examiner_areas.map((a, i) => {
            const done = coveredAreas.has(a.id)
            return (
              <p key={a.id} className={`text-sm py-0.5 flex items-center gap-2 ${done ? 'text-green-600' : 'text-gray-600'}`}>
                <span className={`w-4 h-4 rounded-full text-[10px] font-semibold flex items-center justify-center flex-shrink-0 ${
                  done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>{done ? '✓' : i + 1}</span>
                {a.topic}
              </p>
            )
          })}
        </div>
      )}
      {isStagedType && (
        <p className="mb-3 pb-3 border-b border-gray-200 text-sm text-gray-600">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1">Progress</span>
          Stage {currentStage + 1} of {stagesArr.length}: <span className="font-medium">{stagesArr[currentStage]?.title}</span>
        </p>
      )}
      {hasCriteria && assignment.criteria.map((criterion) => {
        const isOpen = expandedCriteria[criterion.id] !== false
        return (
          <div key={criterion.id}>
            <button
              onClick={() => setExpandedCriteria((prev) => ({ ...prev, [criterion.id]: !prev[criterion.id] }))}
              className="w-full flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 py-1 text-left"
            >
              <ChevronRight className={`w-3.5 h-3.5 text-primary-500 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              <span className="font-medium">{criterion.title}</span>
            </button>
            {isOpen && criterion.description && (
              <p className="text-sm text-gray-500 ml-6 pb-1">{criterion.description}</p>
            )}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="h-screen flex flex-col">
      <header className="bg-surface-darker text-white py-4 px-6 shadow-md flex-shrink-0">
        <div className="flex items-center gap-4">
          {assignment?.voice_config?.enabled === true && (
            <button
              onClick={() => { setVoiceMuted((m) => !m); if (!voiceMuted) audioRef.current?.pause() }}
              className="text-white/80 hover:text-white text-xs font-medium px-2 py-1 rounded border border-white/30 order-last ml-auto"
              title={voiceMuted ? 'Unmute spoken replies' : 'Mute spoken replies'}
            >
              {voiceMuted ? '🔇 Voice off' : '🔊 Voice on'}
            </button>
          )}
          <button
            onClick={() => navigate('/')}
            className="text-white/80 hover:text-white font-medium text-sm inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              {assignment?.title || 'AI Simulation Assignment'}
            </h1>
            {user && <p className="text-sm text-white/80 mt-0.5">Welcome, {user.name}</p>}
          </div>
        </div>
      </header>

      {showBriefing ? (
        /* Briefing screen: shown before chat begins for new sessions */
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto p-5 flex flex-col gap-5 py-8">
            {/* Scenario */}
            {assignment?.description && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800 mb-3">
                  <BookOpen className="w-5 h-5 text-primary-500" />
                  About this Simulation
                </h2>
                <p className="text-gray-600 leading-relaxed whitespace-pre-line">{assignment.description}</p>
              </div>
            )}

            {/* Persona callout */}
            {assignment?.persona_name && (
              <div className="bg-primary-50 border border-primary-200 rounded-xl p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                  <User className="w-6 h-6 text-primary-600" />
                </div>
                <div>
                  <p className="text-sm text-primary-600 font-medium">You'll be speaking with</p>
                  <p className="text-lg font-semibold text-primary-800">{assignment.persona_name}</p>
                </div>
              </div>
            )}

            {/* How it works */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-3">How it works</h2>
              <ul className="space-y-2 text-gray-600 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-primary-500 mt-0.5">&#8226;</span>
                  You'll have a conversation with an AI-powered character. Respond as you would in a real situation.
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary-500 mt-0.5">&#8226;</span>
                  Take your time — there's no time limit.
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary-500 mt-0.5">&#8226;</span>
                  When you're ready to finish, click "Complete Simulation" to receive your evaluation.
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary-500 mt-0.5">&#8226;</span>
                  {scoringEnabled && hasCriteria
                    ? "You'll be evaluated on the criteria listed below."
                    : "You'll receive completion credit for this assignment."}
                </li>
              </ul>
            </div>

            {/* Question areas overview (AI examiner) */}
            {Array.isArray(assignment?.examiner_areas) && assignment.examiner_areas.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-2">
                  {assignment.examiner_style === 'debrief' ? 'Your debrief will cover' : 'The examiner will cover'} {assignment.examiner_areas.length} topics
                </h2>
                <ol className="space-y-1.5">
                  {assignment.examiner_areas.map((a, i) => (
                    <li key={a.id} className="text-sm text-gray-600 flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-primary-100 text-primary-700 text-xs font-semibold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                      {a.topic}
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-gray-400 mt-2">
                  {assignment.examiner_style === 'debrief'
                    ? 'The AI leads the conversation — answer thoughtfully and honestly.'
                    : 'The AI asks the questions and will not confirm whether answers are correct until your evaluation.'}
                </p>
              </div>
            )}

            {/* Stage overview (staged simulations) */}
            {Array.isArray(assignment?.stages) && assignment.stages.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-2">This simulation has {assignment.stages.length} stages</h2>
                <ol className="space-y-1.5">
                  {assignment.stages.map((st, i) => (
                    <li key={st.id} className="text-sm text-gray-600 flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-primary-100 text-primary-700 text-xs font-semibold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                      {st.title}
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-gray-400 mt-2">You'll move to the next stage with a button once you've engaged with the current one.</p>
              </div>
            )}

            {/* Evaluation criteria */}
            {scoringEnabled && hasCriteria && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800 mb-3">
                  <ClipboardList className="w-5 h-5 text-primary-500" />
                  Evaluation Criteria
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

            {/* Previous attempt recap — retry with intent */}
            {prevAttempt && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800 mb-1">
                  <Trophy className="w-5 h-5 text-primary-500" />
                  Your Last Attempt
                </h2>
                <p className="text-sm text-gray-500 mb-3">
                  {prevAttempt.score != null && scoringEnabled && <>You scored <strong>{prevAttempt.score}</strong>. </>}
                  Review where you landed before, and focus on the areas below.
                </p>
                <div className="space-y-2">
                  {(prevAttempt.score_breakdown?.criteria_evaluations || []).map((c) => (
                    <div key={c.id} className="flex items-start justify-between gap-3 text-sm border-l-2 border-gray-200 pl-3">
                      <div className="min-w-0">
                        <span className="font-medium text-gray-700">{c.name || c.id}</span>
                        {c.feedback && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{c.feedback}</p>}
                      </div>
                      {c.level_achieved && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap flex-shrink-0">
                          {c.level_achieved}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {(() => {
                  const scored = (prevAttempt.score_breakdown?.criteria_evaluations || []).filter((c) => c.score != null)
                  const focus = [...scored].sort((a, b) => a.score - b.score).slice(0, 2).map((c) => c.name).filter(Boolean)
                  return focus.length > 0 ? (
                    <p className="text-sm text-primary-700 bg-primary-50 rounded-lg px-3 py-2 mt-3">
                      <strong>Focus areas this attempt:</strong> {focus.join(' and ')}
                    </p>
                  ) : null
                })()}
              </div>
            )}

            {/* Begin button */}
            <div className="flex justify-center pt-2">
              <button
                onClick={() => setShowBriefing(false)}
                className="px-10 py-3.5 bg-primary-500 text-white rounded-xl text-lg font-semibold hover:bg-primary-600 transition-colors flex items-center gap-2 shadow-md"
              >
                <Play className="w-5 h-5" />
                Begin Simulation
              </button>
            </div>
          </div>
        </div>
      ) : phase === 'artifact' && !isCompleted ? (
        /* Artifact write-up phase */
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto p-5 flex flex-col gap-4">
            <SessionInfo session={session} scoringEnabled={scoringEnabled} />

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-1">{assignment?.artifact_config?.title || 'Write-up'}</h2>
              {assignment?.artifact_config?.instructions && (
                <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line mb-3">{assignment.artifact_config.instructions}</p>
              )}
              <details className="mb-3">
                <summary className="text-sm text-primary-600 cursor-pointer select-none">Review your conversation</summary>
                <div className="mt-2 max-h-64 overflow-y-auto space-y-1.5 bg-gray-50 rounded-lg p-3">
                  {interactions.filter((i) => i.metadata?.type !== 'stage_divider').map((i) => (
                    <p key={i.id} className="text-xs text-gray-600">
                      <span className="font-semibold">{i.role === 'user' ? 'You' : (assignment?.persona_name || 'AI')}:</span> {i.content}
                    </p>
                  ))}
                </div>
              </details>
              <textarea
                value={artifactText}
                onChange={(e) => setArtifactText(e.target.value)}
                rows="16"
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none resize-y text-sm"
                aria-label={assignment?.artifact_config?.title || 'Write-up'}
              />
              <div className="flex items-center justify-between mt-1 text-xs text-gray-400">
                <span>
                  {artifactWords} words
                  {assignment?.artifact_config?.min_words && ` (minimum ${assignment.artifact_config.min_words})`}
                  {assignment?.artifact_config?.max_words && ` · aim for under ${assignment.artifact_config.max_words}`}
                </span>
                <span>Draft saves automatically</span>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => setPhase('chat')}
                  className="px-4 py-2.5 border-2 border-gray-200 text-gray-600 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                >
                  Back to conversation
                </button>
                <button
                  onClick={handleCompleteSimulation}
                  disabled={submittingGrade || !artifactText.trim() || (assignment?.artifact_config?.min_words && artifactWords < assignment.artifact_config.min_words)}
                  className="px-6 py-2.5 bg-success text-white rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  {submittingGrade ? (<><Loader2 className="w-4 h-4 animate-spin" /> Evaluating…</>) : 'Submit & Complete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : isCompleted && (isPendingReview || ['pending_evaluation', 'evaluating'].includes(session?.evaluation_status)) ? (
        /* Pending Review / evaluation-in-progress state */
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto p-5 flex flex-col gap-4">
            <SessionInfo session={session} scoringEnabled={scoringEnabled} />

            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-8 text-center animate-scale-in">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center mx-auto mb-4 shadow-lg">
                <Clock className="w-10 h-10 text-white" />
              </div>
              {['pending_evaluation', 'evaluating'].includes(session?.evaluation_status) ? (
                <>
                  <h2 className="text-2xl font-bold text-blue-800 mb-2">Evaluation in Progress</h2>
                  <p className="text-blue-600 mt-2 leading-relaxed max-w-md mx-auto">
                    Your simulation has been completed and submitted. Your work is being evaluated —
                    check back in a few minutes to see your feedback.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-bold text-blue-800 mb-2">Submitted for Review</h2>
                  <p className="text-blue-600 mt-2 leading-relaxed max-w-md mx-auto">
                    Your simulation has been completed and submitted. Your instructor will review your work and release your feedback and score.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      ) : isCompleted ? (
        /* Completed state: single-column centered layout */
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto p-5 flex flex-col gap-4">
            <SessionInfo session={session} scoringEnabled={scoringEnabled} />

            <div className="bg-gradient-to-br from-green-50 to-teal-50 border border-green-200 rounded-xl p-8 text-center animate-scale-in">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center mx-auto mb-4 shadow-lg animate-bounce-in">
                <Trophy className="w-10 h-10 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-green-800 mb-2">Simulation Completed!</h2>

              {scoringEnabled ? (
                <div className="my-4">
                  <div className="w-28 h-28 rounded-full border-4 border-green-500 flex items-center justify-center mx-auto">
                    <span className="text-2xl font-bold text-green-700">{session.score}%</span>
                  </div>
                  {prevAttempt?.score != null && !session.is_practice && (
                    <p className="text-sm text-gray-500 mt-2">
                      Previous attempt: {prevAttempt.score}
                      {Number(session.score) > Number(prevAttempt.score) && <span className="text-green-600 font-medium"> ▲ improved</span>}
                    </p>
                  )}
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
                          AI evaluation was unavailable for this session. Your score is based on participation (messages sent) rather than rubric criteria.
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
                      <h3 className="font-semibold text-gray-700 mb-3 text-sm">Criteria Evaluation</h3>
                      <div className="space-y-3">
                        {evaluation.criteria_evaluations.map((c) => {
                          const criterion = assignment?.criteria?.find((cr) => cr.id === c.id)
                          const criterionName = c.name || criterion?.title || c.id
                          const maxPts = criterion?.max_points || c.score
                          const pct = scoringEnabled && maxPts > 0 && c.score !== undefined ? (c.score / maxPts) * 100 : 0

                          // Color-code level badge
                          const levelColors = (() => {
                            const level = (c.level_achieved || '').toLowerCase()
                            if (level.includes('excellent') || level.includes('exceptional') || level.includes('mastery')) return 'bg-green-100 text-green-700'
                            if (level.includes('good') || level.includes('proficient') || level.includes('competent')) return 'bg-blue-100 text-blue-700'
                            if (level.includes('developing') || level.includes('basic') || level.includes('needs')) return 'bg-amber-100 text-amber-700'
                            if (level.includes('inadequate') || level.includes('poor') || level.includes('minimal') || level.includes('unsatisfactory')) return 'bg-red-100 text-red-700'
                            return 'bg-gray-100 text-gray-600'
                          })()

                          return (
                            <div key={c.id} className="border border-gray-100 rounded-lg p-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-gray-800 font-semibold text-sm">{criterionName}</span>
                                <span className="flex items-center gap-2">
                                  {c.level_achieved && (
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${levelColors}`}>
                                      {c.level_achieved}
                                    </span>
                                  )}
                                  {scoringEnabled && c.score !== undefined && maxPts > 0 && (
                                    <span className="font-semibold text-gray-800 text-sm">{c.score}/{maxPts}</span>
                                  )}
                                </span>
                              </div>
                              {(() => {
                                const prev = prevAttempt?.score_breakdown?.criteria_evaluations?.find((p) => p.id === c.id)
                                if (!prev?.level_achieved || !c.level_achieved
                                  || prev.level_achieved === c.level_achieved || session.is_practice) return null
                                const improved = prev.score != null && c.score != null && c.score > prev.score
                                return (
                                  <p className={`text-xs mb-1 ${improved ? 'text-green-600' : 'text-gray-400'}`}>
                                    {improved ? '▲ ' : ''}was "{prev.level_achieved}" last attempt
                                  </p>
                                )
                              })()}
                              {scoringEnabled && maxPts > 0 && c.score !== undefined && (
                                <div className="w-full bg-gray-200 rounded-full h-1.5 mb-2">
                                  <div
                                    className="bg-primary-500 h-1.5 rounded-full transition-all"
                                    style={{ width: `${Math.min(pct, 100)}%` }}
                                  />
                                </div>
                              )}
                              {c.feedback && <p className="text-sm text-gray-600 leading-relaxed">{c.feedback}</p>}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Evidence-linked conversation review */}
              {evaluation && interactions.length > 0 && (() => {
                // Number student messages the same way the grader does, and
                // map each number to the criteria that cited it as evidence.
                let n = 0
                const numbered = interactions.map((i) => (i.role === 'user' ? { ...i, msgNum: ++n } : i))
                const citedBy = new Map()
                for (const c of evaluation.criteria_evaluations || []) {
                  for (const num of c.evidence_messages || []) {
                    const list = citedBy.get(num) || []
                    list.push(c.name || c.id)
                    citedBy.set(num, list)
                  }
                }
                if (citedBy.size === 0) return null
                return (
                  <details className="mt-4 text-left bg-white rounded-lg shadow-sm">
                    <summary className="px-4 py-3 text-sm font-semibold text-gray-700 cursor-pointer select-none">
                      Review your conversation — highlighted messages are the ones your feedback is based on
                    </summary>
                    <div className="px-4 pb-4 space-y-2 max-h-96 overflow-y-auto">
                      {numbered.map((i) => {
                        const cites = i.msgNum ? citedBy.get(i.msgNum) : null
                        return (
                          <div
                            key={i.id}
                            className={`p-3 rounded-lg text-sm ${
                              i.role === 'user'
                                ? cites ? 'bg-primary-50 border border-primary-200 ml-6' : 'bg-blue-50 ml-6'
                                : 'bg-gray-50 mr-6'
                            }`}
                          >
                            <div className="flex justify-between items-start gap-2 mb-1">
                              <span className="text-xs font-semibold text-gray-500">
                                {i.role === 'user' ? `You${i.msgNum ? ` (message ${i.msgNum})` : ''}` : (assignment?.persona_name || 'AI')}
                              </span>
                              {cites && (
                                <span className="flex gap-1 flex-wrap justify-end">
                                  {[...new Set(cites)].map((name) => (
                                    <span key={name} className="text-[10px] px-1.5 py-0.5 bg-primary-100 text-primary-700 rounded-full font-medium">
                                      {name}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </div>
                            <p className="text-gray-700 leading-relaxed">{i.content}</p>
                          </div>
                        )
                      })}
                    </div>
                  </details>
                )
              })()}

              <p className="text-green-600 text-sm mt-4">
                {session.is_practice
                  ? 'Practice session — no grade was sent to the gradebook, and no attempt was used.'
                  : scoringEnabled
                  ? 'Your grade has been submitted to Canvas.'
                  : 'Completion credit has been submitted to Canvas.'}
              </p>
            </div>
          </div>
        </div>
      ) : hasCriteria ? (
        /* Active state with criteria: side-by-side on desktop, stacked on mobile */
        <div className="flex-1 overflow-hidden">
          {/* Mobile: stacked layout */}
          <div className="lg:hidden h-full overflow-y-auto">
            <div className="max-w-4xl mx-auto p-5 flex flex-col gap-4">
              <SessionInfo session={session} scoringEnabled={scoringEnabled} />

              {/* Description */}
              {assignment?.description && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-100 px-4 py-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-600 mb-1.5">
                    <BookOpen className="w-4 h-4 text-primary-500" />
                    About this Simulation
                  </h3>
                  <p className="text-sm text-gray-500 leading-relaxed whitespace-pre-line">{assignment.description}</p>
                </div>
              )}

              {/* Mobile collapsible objectives */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                <button
                  onClick={() => setCriteriaExpanded(!criteriaExpanded)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  <span className="flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-primary-500" />
                    Objectives ({assignment.criteria.length})
                  </span>
                  {criteriaExpanded
                    ? <ChevronUp className="w-4 h-4 text-gray-400" />
                    : <ChevronDown className="w-4 h-4 text-gray-400" />
                  }
                </button>
                {criteriaExpanded && (
                  <div className="px-4 pb-3">
                    {objectivesContent}
                  </div>
                )}
              </div>

              <div className="h-[500px] md:h-[600px]">
                <ChatInterface
                  interactions={interactions}
                  onSendMessage={handleSendMessage}
                  disabled={maxReached}
                  isTyping={isTyping}
                  personaName={assignment?.persona_name}
                  voiceEnabled={assignment?.voice_config?.enabled === true}
                  sessionId={session?.id}
                />
              </div>

              <div className="flex justify-center py-2">
                <div className="flex flex-col items-center gap-1">
                  <button
                    onClick={primaryAction}
                    disabled={primaryDisabled}
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
                        {primaryLabel}
                      </>
                    )}
                  </button>
                  {!canComplete && minMessages && (
                    <span className="text-xs text-gray-400">
                      {interactions.filter((i) => i.role === 'user').length} of {minMessages} required messages sent
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Desktop: side-by-side grid */}
          <div className="hidden lg:grid lg:grid-cols-[320px_1fr] h-full">
            <aside className="bg-gray-50 border-r border-gray-200 overflow-y-auto p-5 flex flex-col gap-4">
              <SessionInfo session={session} scoringEnabled={scoringEnabled} />
              {assignment?.description && (
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-600 mb-1.5">
                    <BookOpen className="w-4 h-4 text-primary-500" />
                    About this Simulation
                  </h3>
                  <p className="text-sm text-gray-500 leading-relaxed whitespace-pre-line">{assignment.description}</p>
                </div>
              )}
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-600 mb-2">
                  <ClipboardList className="w-4 h-4 text-primary-500" />
                  Objectives ({assignment.criteria.length})
                </h3>
                {objectivesContent}
              </div>
            </aside>

            <main className="flex flex-col min-h-0 p-5 gap-4">
              <div className="flex-1 min-h-0">
                <ChatInterface
                  interactions={interactions}
                  onSendMessage={handleSendMessage}
                  disabled={maxReached}
                  isTyping={isTyping}
                  personaName={assignment?.persona_name}
                  voiceEnabled={assignment?.voice_config?.enabled === true}
                  sessionId={session?.id}
                />
              </div>

              <div className="flex justify-center flex-shrink-0">
                <div className="flex flex-col items-center gap-1">
                  <button
                    onClick={primaryAction}
                    disabled={primaryDisabled}
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
                        {primaryLabel}
                      </>
                    )}
                  </button>
                  {!canComplete && minMessages && (
                    <span className="text-xs text-gray-400">
                      {interactions.filter((i) => i.role === 'user').length} of {minMessages} required messages sent
                    </span>
                  )}
                </div>
              </div>
            </main>
          </div>
        </div>
      ) : (
        /* Active state without criteria: full-width chat */
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="max-w-4xl w-full mx-auto p-5 flex flex-col gap-4 flex-1 min-h-0">
            <SessionInfo session={session} scoringEnabled={scoringEnabled} />

            <div className="flex-1 min-h-0 h-[500px] md:h-[600px] lg:h-auto">
              <ChatInterface
                interactions={interactions}
                onSendMessage={handleSendMessage}
                disabled={maxReached}
                isTyping={isTyping}
                personaName={assignment?.persona_name}
                voiceEnabled={assignment?.voice_config?.enabled === true}
                sessionId={session?.id}
              />
            </div>

            <div className="flex justify-center py-2 flex-shrink-0">
              <div className="flex flex-col items-center gap-1">
                <button
                  onClick={primaryAction}
                  disabled={primaryDisabled}
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
                      {primaryLabel}
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
        </div>
      )}
    </div>
  )
}

export default SimulationPage
