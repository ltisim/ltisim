import React, { useState, useEffect } from 'react'
import { adminAPI } from '../utils/api'
import { useToast } from './Toast'
import { X, ClipboardList, Award, MessageSquare, History, CheckCircle, XCircle, Star, Flag, Trash2, AlertTriangle, Clock, Edit3, Check, Sparkles, RefreshCw } from 'lucide-react'

const PASSBACK_BADGES = {
  submitted: { label: 'submitted', cls: 'bg-green-100 text-green-800' },
  failed: { label: 'failed', cls: 'bg-red-100 text-red-800' },
  failed_permanent: { label: 'failed (gave up)', cls: 'bg-red-100 text-red-800' },
  pending_retry: { label: 'retry scheduled', cls: 'bg-amber-100 text-amber-800' },
  retrying: { label: 'retrying', cls: 'bg-amber-100 text-amber-800' },
  superseded: { label: 'superseded', cls: 'bg-gray-200 text-gray-600' },
  pending: { label: 'pending', cls: 'bg-amber-100 text-amber-800' },
}

function StudentSessionDetail({ sessionId, onClose }) {
  const { showToast } = useToast()
  const [sessionData, setSessionData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editOverrides, setEditOverrides] = useState({})
  const [releasing, setReleasing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exemplarModalOpen, setExemplarModalOpen] = useState(false)
  const [regrading, setRegrading] = useState(false)
  const [retryingGrade, setRetryingGrade] = useState(false)
  const [highlightedMsg, setHighlightedMsg] = useState(null)
  // Blind grading: false | 'grading' | 'reveal'. While 'grading', the AI
  // evaluation is hidden so the instructor's judgment is uncontaminated.
  const [blindMode, setBlindMode] = useState(false)
  const [blindGrades, setBlindGrades] = useState({})
  const [blindResult, setBlindResult] = useState(null)
  const [submittingBlind, setSubmittingBlind] = useState(false)

  const scrollToMessage = (n) => {
    const el = document.getElementById(`transcript-msg-${n}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedMsg(n)
      setTimeout(() => setHighlightedMsg(null), 2500)
    }
  }

  const handleSubmitBlindGrades = async () => {
    const grades = Object.entries(blindGrades)
      .filter(([, g]) => g.level || g.score != null)
      .map(([criterion_id, g]) => ({ criterion_id, level: g.level || null, score: g.score != null ? Number(g.score) : null }))
    if (grades.length === 0) {
      showToast('Select a level for at least one criterion first', 'error')
      return
    }
    try {
      setSubmittingBlind(true)
      const response = await adminAPI.blindGrade(sessionId, grades)
      setBlindResult(response.data)
      setBlindMode('reveal')
      showToast('Blind grades recorded — comparison below', 'success')
    } catch (err) {
      console.error('Error submitting blind grades:', err)
      showToast(err.response?.data?.error || 'Failed to record blind grades', 'error')
    } finally {
      setSubmittingBlind(false)
    }
  }

  const handleRetryGrade = async () => {
    try {
      setRetryingGrade(true)
      const response = await adminAPI.retryGrade(sessionId)
      await loadSessionDetail()
      if (response.data.success) {
        showToast('Grade submitted to the LMS', 'success')
      } else {
        showToast(response.data.error || 'Passback failed again — queued for automatic retry', 'error')
      }
    } catch (err) {
      console.error('Error retrying grade passback:', err)
      showToast(err.response?.data?.error || 'Failed to retry grade passback', 'error')
    } finally {
      setRetryingGrade(false)
    }
  }

  const handleRegrade = async () => {
    if (!confirm('Regrade this session with the current rubric? This replaces the existing AI evaluation draft. The Canvas gradebook is not affected until you release.')) {
      return
    }
    try {
      setRegrading(true)
      await adminAPI.regradeSession(sessionId)
      await loadSessionDetail()
      showToast('Session regraded with current rubric', 'success')
    } catch (err) {
      console.error('Error regrading session:', err)
      showToast(err.response?.data?.error || 'Failed to regrade session', 'error')
    } finally {
      setRegrading(false)
    }
  }

  useEffect(() => {
    loadSessionDetail()
  }, [sessionId])

  const loadSessionDetail = async () => {
    try {
      setLoading(true)
      const response = await adminAPI.getSessionDetail(sessionId)
      setSessionData(response.data)
      setError(null)
    } catch (err) {
      console.error('Error loading session detail:', err)
      setError('Failed to load session details. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteFeedback = async (feedbackId) => {
    if (!confirm('Are you sure you want to delete this feedback?')) {
      return
    }

    try {
      await adminAPI.deleteFeedback(feedbackId)
      await loadSessionDetail()
      showToast('Feedback deleted', 'success')
    } catch (err) {
      console.error('Error deleting feedback:', err)
      showToast('Failed to delete feedback', 'error')
    }
  }

  const initEditOverrides = () => {
    if (!sessionData) return
    const { session } = sessionData
    const criteria = session.score_breakdown?.criteria_evaluations || []
    setEditOverrides({
      overall_feedback: session.ai_evaluation?.overall_feedback || '',
      criteria: criteria.map((c) => ({ ...c })),
      score: session.score,
    })
    setEditing(true)
  }

  const handleEditCriterionScore = (index, value) => {
    setEditOverrides((prev) => {
      const newCriteria = [...prev.criteria]
      newCriteria[index] = { ...newCriteria[index], score: value }
      const newTotal = newCriteria.reduce((sum, c) => sum + (Number(c.score) || 0), 0)
      return { ...prev, criteria: newCriteria, score: newTotal }
    })
  }

  const handleEditCriterionFeedback = (index, value) => {
    setEditOverrides((prev) => {
      const newCriteria = [...prev.criteria]
      newCriteria[index] = { ...newCriteria[index], feedback: value }
      return { ...prev, criteria: newCriteria }
    })
  }

  const handleSaveEdits = async () => {
    try {
      setSaving(true)
      const response = await adminAPI.saveEvaluation(sessionId, {
        score: editOverrides.score,
        score_breakdown: { criteria_evaluations: editOverrides.criteria },
        overall_feedback: editOverrides.overall_feedback,
      })
      const { gradeUpdated, gradeSubmission } = response.data
      if (gradeUpdated && gradeSubmission?.success) {
        showToast('Evaluation saved and gradebook updated', 'success')
      } else if (gradeUpdated && !gradeSubmission?.success) {
        showToast('Evaluation saved but gradebook update failed', 'warning')
      } else {
        showToast('Evaluation edits saved', 'success')
      }
      setEditing(false)
      await loadSessionDetail()
    } catch (err) {
      console.error('Error saving evaluation:', err)
      showToast('Failed to save evaluation', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleRelease = async () => {
    try {
      setReleasing(true)
      const overrides = {}

      if (editing) {
        overrides.score = editOverrides.score
        overrides.score_breakdown = { criteria_evaluations: editOverrides.criteria }
        overrides.overall_feedback = editOverrides.overall_feedback
      }

      await adminAPI.releaseSession(sessionId, overrides)
      showToast('Session released to student', 'success')
      setEditing(false)
      await loadSessionDetail()
    } catch (err) {
      console.error('Error releasing session:', err)
      showToast('Failed to release session', 'error')
    } finally {
      setReleasing(false)
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A'
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center">
        <div className="loading-spinner" />
        <p className="mt-4 text-gray-500">Loading session details...</p>
      </div>
    )
  }

  if (error || !sessionData) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center gap-4 p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg px-6 py-4 text-red-700 text-center">
          {error || 'Session not found'}
        </div>
        <button onClick={onClose} className="px-5 py-2 bg-gray-500 text-white rounded-lg font-medium hover:bg-gray-600 transition-colors">
          Back to Dashboard
        </button>
      </div>
    )
  }

  const { session, interactions, feedback, gradeSubmissions } = sessionData

  // Determine scoring mode: check ai_evaluation first, fall back to assignment flag
  const scoringEnabled = session.ai_evaluation?.scoring_enabled !== undefined
    ? session.ai_evaluation.scoring_enabled
    : session.assignment_scoring_enabled !== false

  // Get criteria evaluations from new format, fall back to old format for pre-migration sessions
  const criteriaEvaluations = session.score_breakdown?.criteria_evaluations
    || (session.score_breakdown?.criteria_scores || []).map((c) => ({
      ...c,
      level_achieved: null,
    }))

  // Legacy goals_met for pre-migration sessions (only shown if no criteria_evaluations cover them)
  const legacyGoalsMet = (!session.score_breakdown?.criteria_evaluations && session.goals_met?.length > 0)
    ? session.goals_met
    : null

  // Student messages are numbered for every type — the grader cites evidence
  // by these numbers ([Prompt N] for llm_interaction, [Message N] otherwise).
  const isLLMInteraction = session.assignment_type === 'llm_interaction'
  const userLabel = isLLMInteraction ? 'Prompt' : 'Message'
  const promptNumbers = {}
  {
    let n = 0
    for (const it of interactions) {
      if (it.role === 'user') promptNumbers[it.id] = ++n
    }
  }

  const msgButton = (n) => (
    <button
      key={n}
      onClick={() => scrollToMessage(n)}
      className="px-1.5 py-0.5 bg-primary-50 text-primary-700 rounded hover:bg-primary-100 font-medium transition-colors"
      title={`Jump to ${userLabel.toLowerCase()} ${n} in the transcript`}
    >
      #{n}
    </button>
  )

  const mappingLine = (c) => {
    if (!isLLMInteraction || !Array.isArray(c.mapped_prompts)) return null
    return (
      <div className="text-xs text-gray-500 mb-1.5 flex items-center gap-1 flex-wrap">
        {c.mapped_prompts.length > 0
          ? <>Graded on prompt{c.mapped_prompts.length > 1 ? 's' : ''} {c.mapped_prompts.map(msgButton)}</>
          : <span className="text-amber-600">No matching prompt found — task not demonstrated</span>}
        {c.mapping_note && <span className="text-gray-400"> — {c.mapping_note}</span>}
      </div>
    )
  }

  // Evidence citations (simulation type; llm_interaction's mapping line above
  // already serves as evidence). Clicking a number scrolls the transcript.
  const evidenceLine = (c) => {
    if (isLLMInteraction) return null
    if (!Array.isArray(c.evidence_messages) || c.evidence_messages.length === 0) return null
    return (
      <div className="text-xs text-gray-500 mb-1.5 flex items-center gap-1 flex-wrap">
        <span>Evidence:</span>
        {c.evidence_messages.map(msgButton)}
      </div>
    )
  }

  // Grader self-reported confidence. High is the norm and stays unbadged.
  const confidenceBadge = (c) => {
    if (!c.confidence || c.confidence === 'high') return null
    const cls = c.confidence === 'low'
      ? 'bg-red-50 text-red-600 border border-red-200'
      : 'bg-amber-50 text-amber-700 border border-amber-200'
    return (
      <span title={c.confidence_note || 'Grader-reported confidence'} className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>
        {c.confidence} confidence
      </span>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-8">
      <header className="bg-surface-darker text-white py-5 px-6 flex justify-between items-center shadow-md">
        <div>
          <h1 className="text-xl font-bold">Session Review</h1>
          <p className="text-sm text-white/80 mt-0.5">Student: {session.student_name}</p>
        </div>
        <button
          onClick={onClose}
          className="w-10 h-10 border-2 border-white rounded-full flex items-center justify-center text-white hover:bg-white hover:text-surface-darker transition-all"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="max-w-5xl mx-auto px-6 mt-6 flex flex-col gap-5">
        {/* Session Info Card */}
        <div className="bg-white rounded-lg p-5 shadow-sm">
          <h2 className="text-lg font-bold text-surface-dark mb-3 pb-2 border-b-2 border-gray-100 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-primary-500" />
            Session Information
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: 'Student Email', value: session.student_email },
              { label: 'Assignment', value: session.assignment_title },
              { label: 'Status', value: (
                <span className={`inline-block whitespace-nowrap px-3 py-1 rounded-full text-xs font-semibold ${
                  session.review_status === 'pending_review' ? 'bg-amber-500 text-white'
                    : session.review_status === 'released' ? 'bg-green-600 text-white'
                    : session.status === 'completed' ? 'bg-success text-white'
                    : 'bg-primary-500 text-white'
                }`}>
                  {session.review_status === 'pending_review' ? 'Pending Review'
                    : session.review_status === 'released' ? 'Released'
                    : session.status === 'in_progress' ? 'In Progress'
                    : 'Completed'}
                </span>
              )},
              { label: 'Started', value: formatDate(session.started_at) },
              { label: 'Completed', value: formatDate(session.completed_at) },
              { label: 'Score', value: (
                <span className="font-bold text-success text-lg">
                  {!scoringEnabled
                    ? 'Complete'
                    : session.score !== null ? `${session.score}%` : 'N/A'}
                </span>
              )},
            ].map((item, i) => (
              <div key={i} className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{item.label}</span>
                <span className="text-gray-700">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Evaluation retrying / failed banner */}
        {['pending_evaluation', 'evaluating'].includes(session.evaluation_status) && (
          <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-5 shadow-sm flex items-center gap-3">
            <Clock className="w-6 h-6 text-blue-500 flex-shrink-0" />
            <div>
              <p className="font-semibold text-blue-800">AI Evaluation Retrying</p>
              <p className="text-sm text-blue-600">
                The AI evaluation failed when this session was completed and is being retried automatically
                (attempt {session.evaluation_attempts || 1}). You can also run it now with the Regrade button,
                or grade manually with Edit Evaluation. No grade has been sent to the LMS.
              </p>
            </div>
          </div>
        )}
        {session.evaluation_status === 'failed_permanent' && (
          <div className="bg-red-50 border-2 border-red-300 rounded-lg p-5 shadow-sm flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0" />
            <div>
              <p className="font-semibold text-red-800">AI Evaluation Failed</p>
              <p className="text-sm text-red-600">
                Automatic evaluation retries were exhausted{session.evaluation_error ? ` (${session.evaluation_error})` : ''}.
                Use Regrade to try again, or grade this session manually with Edit Evaluation. No grade has
                been sent to the LMS.
              </p>
            </div>
          </div>
        )}

        {/* Pending Review Banner */}
        {session.review_status === 'pending_review' && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-5 shadow-sm flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Clock className="w-6 h-6 text-amber-500 flex-shrink-0" />
              <div>
                <p className="font-semibold text-amber-800">Pending Instructor Review</p>
                <p className="text-sm text-amber-600">This session is awaiting your review. You can edit the AI evaluation below before releasing it to the student.</p>
              </div>
            </div>
            <button
              onClick={handleRelease}
              disabled={releasing}
              className="px-5 py-2.5 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2 flex-shrink-0"
            >
              {releasing ? (
                <>Releasing...</>
              ) : (
                <><Check className="w-4 h-4" /> Release to Student</>
              )}
            </button>
          </div>
        )}

        {/* Released Banner */}
        {session.review_status === 'released' && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 shadow-sm flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
            <p className="text-green-700 text-sm">
              <span className="font-semibold">Released to student</span>
              {session.released_at && ` on ${formatDate(session.released_at)}`}
            </p>
          </div>
        )}

        {/* Blind grading panel: instructor grades WITHOUT seeing the AI draft */}
        {blindMode === 'grading' && (
          <div className="bg-white rounded-lg p-5 shadow-sm border-2 border-indigo-200">
            <div className="flex items-center justify-between mb-3 pb-2 border-b-2 border-gray-100">
              <h2 className="text-lg font-bold text-surface-dark flex items-center gap-2">
                <Award className="w-5 h-5 text-indigo-500" />
                Blind Grade
              </h2>
              <button
                onClick={() => { setBlindMode(false); setBlindGrades({}) }}
                className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-md font-medium hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              The AI evaluation is hidden. Read the transcript below, pick a level for each criterion
              (and adjust points if needed), then submit to see how your grading compares with the AI's.
              Your comparison is recorded to measure grading accuracy; the AI draft is not changed.
            </p>
            <div className="space-y-3">
              {(session.assignment_rubric || []).map((criterion) => {
                const g = blindGrades[criterion.id] || {}
                return (
                  <div key={criterion.id} className="border border-indigo-100 rounded-lg p-3 bg-indigo-50/30">
                    <div className="flex justify-between items-start gap-3 text-sm mb-1">
                      <div>
                        <span className="text-gray-800 font-semibold">{criterion.name}</span>
                        {criterion.description && <p className="text-xs text-gray-500 mt-0.5">{criterion.description}</p>}
                      </div>
                      {scoringEnabled && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <input
                            type="number"
                            min="0"
                            max={criterion.max_points}
                            value={g.score ?? ''}
                            placeholder="pts"
                            onChange={(e) => setBlindGrades((prev) => ({
                              ...prev,
                              [criterion.id]: { ...prev[criterion.id], score: e.target.value === '' ? null : Number(e.target.value) },
                            }))}
                            className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center"
                          />
                          <span className="text-gray-400 text-sm">/ {criterion.max_points}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {(criterion.levels || []).map((level) => (
                        <button
                          key={level.label}
                          onClick={() => setBlindGrades((prev) => ({
                            ...prev,
                            [criterion.id]: {
                              level: level.label,
                              score: scoringEnabled ? (level.score ?? prev[criterion.id]?.score ?? null) : null,
                            },
                          }))}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                            g.level === level.label
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                          }`}
                          title={level.description || ''}
                        >
                          {level.label}{scoringEnabled && level.score != null ? ` (${level.score})` : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            <button
              onClick={handleSubmitBlindGrades}
              disabled={submittingBlind}
              className="mt-4 px-5 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {submittingBlind ? 'Recording…' : 'Submit & Compare with AI'}
            </button>
          </div>
        )}

        {/* Blind grading reveal: side-by-side comparison */}
        {blindMode === 'reveal' && blindResult && (
          <div className="bg-white rounded-lg p-5 shadow-sm border-2 border-indigo-200">
            <div className="flex items-center justify-between mb-3 pb-2 border-b-2 border-gray-100">
              <h2 className="text-lg font-bold text-surface-dark flex items-center gap-2">
                <Award className="w-5 h-5 text-indigo-500" />
                Your Grading vs. AI
              </h2>
              <button
                onClick={() => { setBlindMode(false); setBlindGrades({}); setBlindResult(null) }}
                className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-md font-medium hover:bg-gray-200 transition-colors"
              >
                Done
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-3">
              Levels matched on <strong>{blindResult.summary.level_matches} of {blindResult.summary.total}</strong> criteria
              {blindResult.summary.score_mae != null && <> · average score difference <strong>{blindResult.summary.score_mae} pts</strong></>}.
              This comparison was recorded for grading-accuracy measurement.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                    <th className="py-2 pr-3">Criterion</th>
                    <th className="py-2 pr-3">Your grade</th>
                    <th className="py-2 pr-3">AI grade</th>
                    <th className="py-2 pr-3">AI confidence</th>
                    <th className="py-2">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {blindResult.comparison.map((c) => (
                    <tr key={c.criterion_id} className="border-b border-gray-50">
                      <td className="py-2 pr-3 font-medium text-gray-700">{c.name}</td>
                      <td className="py-2 pr-3">{c.human_level || '—'}{c.human_score != null && ` · ${c.human_score}/${c.max_points}`}</td>
                      <td className="py-2 pr-3">{c.ai_level || '—'}{c.ai_score != null && ` · ${c.ai_score}/${c.max_points}`}</td>
                      <td className="py-2 pr-3 text-gray-500">{c.ai_confidence || '—'}</td>
                      <td className="py-2">
                        {c.level_match
                          ? <CheckCircle className="w-4 h-4 text-success" />
                          : <XCircle className="w-4 h-4 text-danger" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* AI Evaluation (hidden while blind grading is in progress) */}
        {session.status === 'completed' && session.ai_evaluation && blindMode !== 'grading' && (
          <div className="bg-white rounded-lg p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3 pb-2 border-b-2 border-gray-100">
              <h2 className="text-lg font-bold text-surface-dark flex items-center gap-2">
                <Award className="w-5 h-5 text-primary-500" />
                AI Evaluation
              </h2>
              {!editing && (
                <div className="flex items-center gap-2">
                  {session.review_status === 'pending_review' && criteriaEvaluations.length > 0 && (session.assignment_rubric || []).length > 0 && (
                    <button
                      onClick={() => { setBlindGrades({}); setBlindResult(null); setBlindMode('grading') }}
                      className="px-3 py-1.5 text-xs bg-indigo-100 text-indigo-700 rounded-md font-medium hover:bg-indigo-200 transition-colors inline-flex items-center gap-1"
                      title="Grade this session yourself without seeing the AI draft, then compare. Builds the grading-accuracy dataset."
                    >
                      <Award className="w-3.5 h-3.5" />
                      Blind Grade
                    </button>
                  )}
                  {session.review_status === 'pending_review' && (
                    <button
                      onClick={handleRegrade}
                      disabled={regrading}
                      className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded-md font-medium hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1"
                      title="Re-run AI evaluation with the current rubric. Only available for pending-review sessions — released grades are frozen."
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${regrading ? 'animate-spin' : ''}`} />
                      {regrading ? 'Regrading…' : 'Regrade'}
                    </button>
                  )}
                  {session.status === 'completed' && (session.assignment_rubric || []).length > 0 && (
                    <button
                      onClick={() => setExemplarModalOpen(true)}
                      className="px-3 py-1.5 text-xs bg-amber-100 text-amber-700 rounded-md font-medium hover:bg-amber-200 transition-colors inline-flex items-center gap-1"
                      title="Promote this session to a calibration exemplar for AI grading"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Save as Exemplar
                    </button>
                  )}
                  <button
                    onClick={initEditOverrides}
                    className="px-3 py-1.5 text-xs bg-primary-100 text-primary-700 rounded-md font-medium hover:bg-primary-200 transition-colors inline-flex items-center gap-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Edit Evaluation
                  </button>
                </div>
              )}
              {editing && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveEdits}
                    disabled={saving}
                    className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-md font-medium hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {saving ? 'Saving...' : 'Save Edits'}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-md font-medium hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {session.ai_evaluation.fallback && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-amber-800 font-medium text-sm">Participation-based score</p>
                  <p className="text-amber-700 text-sm mt-0.5">
                    AI evaluation was unavailable for this session. The score is based on participation (messages sent) rather than rubric criteria.
                  </p>
                </div>
              </div>
            )}

            {Array.isArray(session.score_breakdown?.consistency_notes) && session.score_breakdown.consistency_notes.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-red-800 font-medium text-sm mb-1 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  Artifact consistency check
                </p>
                <p className="text-red-700 text-xs mb-2">Claims in the write-up the evaluator could not find support for in the conversation:</p>
                <ul className="list-disc list-inside space-y-1">
                  {session.score_breakdown.consistency_notes.map((note, i) => (
                    <li key={i} className="text-sm text-red-700">{note}</li>
                  ))}
                </ul>
              </div>
            )}

            {editing ? (
              <div className="mb-4">
                <label className="text-sm font-semibold text-gray-500 block mb-1">Overall Feedback</label>
                <textarea
                  value={editOverrides.overall_feedback}
                  onChange={(e) => setEditOverrides((prev) => ({ ...prev, overall_feedback: e.target.value }))}
                  rows="3"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none resize-y text-sm"
                />
              </div>
            ) : (
              session.ai_evaluation.overall_feedback && (
                <p className="text-gray-600 text-sm mb-4 leading-relaxed">{session.ai_evaluation.overall_feedback}</p>
              )
            )}

            {editing && editOverrides.criteria?.length > 0 ? (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-500">Criteria Evaluation</h3>
                  <span className="text-sm font-bold text-primary-600">Total: {editOverrides.score}</span>
                </div>
                <div className="space-y-3">
                  {editOverrides.criteria.map((c, i) => {
                    const rubricCriterion = session.assignment_rubric?.find((r) => r.id === c.id)
                    const criterionName = c.name || rubricCriterion?.name || c.id
                    const maxPts = rubricCriterion?.max_points || 0

                    return (
                      <div key={i} className="border border-primary-200 rounded-lg p-3 bg-primary-50/30">
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-gray-800 font-semibold">{criterionName}</span>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min="0"
                              max={maxPts}
                              value={c.score ?? 0}
                              onChange={(e) => handleEditCriterionScore(i, Number(e.target.value) || 0)}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center"
                            />
                            <span className="text-gray-400 text-sm">/ {maxPts}</span>
                          </div>
                        </div>
                        {mappingLine(c)}
                        <textarea
                          value={c.feedback || ''}
                          onChange={(e) => handleEditCriterionFeedback(i, e.target.value)}
                          rows="5"
                          placeholder="Criterion feedback..."
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm resize-y focus:border-primary-500 focus:outline-none"
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : criteriaEvaluations.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-gray-500 mb-2">Criteria Evaluation</h3>
                <div className="space-y-3">
                  {criteriaEvaluations.map((c, i) => {
                    const rubricCriterion = session.assignment_rubric?.find((r) => r.id === c.id)
                    const criterionName = c.name || rubricCriterion?.name || c.id
                    const maxPts = rubricCriterion?.max_points || c.score
                    const pct = scoringEnabled && maxPts > 0 ? (c.score / maxPts) * 100 : 0

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
                      <div key={i} className="border border-gray-100 rounded-lg p-3">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-800 font-semibold">
                            {criterionName}
                          </span>
                          <span className="flex items-center gap-2">
                            {confidenceBadge(c)}
                            {c.level_achieved && (
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${levelColors}`}>
                                {c.level_achieved}
                              </span>
                            )}
                            {scoringEnabled && (
                              <span className="font-semibold">{c.score}/{maxPts}</span>
                            )}
                          </span>
                        </div>
                        {scoringEnabled && (
                          <div className="w-full bg-gray-200 rounded-full h-1.5 mb-2">
                            <div
                              className="bg-primary-500 h-1.5 rounded-full transition-all"
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                        )}
                        {mappingLine(c)}
                        {evidenceLine(c)}
                        {c.feedback && <p className="text-sm text-gray-600 leading-relaxed">{c.feedback}</p>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Legacy goals_met display for pre-migration sessions */}
            {legacyGoalsMet && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 mb-2">Goals</h3>
                <div className="space-y-1.5">
                  {legacyGoalsMet.map((g, i) => {
                    const goalDef = session.assignment_goals?.find((ag) => ag.id === g.id)
                    return (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        {g.met
                          ? <CheckCircle className="w-4 h-4 text-success flex-shrink-0 mt-0.5" />
                          : <XCircle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
                        }
                        <div>
                          <span className="font-medium text-gray-700">{goalDef?.title || g.id}</span>
                          {g.evidence && <p className="text-xs text-gray-400 mt-0.5">{g.evidence}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Student artifact (simulation_with_artifact) */}
        {session.data?.artifact?.text && (
          <div className="bg-white rounded-lg p-5 shadow-sm">
            <h2 className="text-lg font-bold text-surface-dark mb-3 pb-2 border-b-2 border-gray-100 flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-primary-500" />
              Student Write-up
              <span className="text-xs font-normal text-gray-400">
                submitted {session.data.artifact.submitted_at ? formatDate(session.data.artifact.submitted_at) : ''}
              </span>
            </h2>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{session.data.artifact.text}</p>
          </div>
        )}

        {/* Conversation Transcript */}
        <div className="bg-white rounded-lg p-5 shadow-sm">
          <h2 className="text-lg font-bold text-surface-dark mb-3 pb-2 border-b-2 border-gray-100 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary-500" />
            Conversation Transcript ({interactions.length} messages)
          </h2>
          <div className="max-h-[600px] overflow-y-auto p-3 bg-gray-50 rounded-lg space-y-3">
            {interactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <MessageSquare className="w-8 h-8 mb-2 text-gray-300" />
                <p className="text-sm">No interactions yet.</p>
              </div>
            ) : (
              interactions.map((interaction) => (
                <div
                  key={interaction.id}
                  id={interaction.role === 'user' && promptNumbers[interaction.id] ? `transcript-msg-${promptNumbers[interaction.id]}` : undefined}
                  className={`p-3 rounded-lg transition-shadow ${
                    interaction.role === 'user'
                      ? 'bg-blue-50 ml-8'
                      : 'bg-amber-50 mr-8'
                  } ${interaction.role === 'user' && highlightedMsg === promptNumbers[interaction.id] ? 'ring-2 ring-primary-500 shadow-md' : ''}`}
                >
                  <div className="flex justify-between mb-1.5 text-xs">
                    <span className="font-semibold text-surface-dark">
                      {interaction.role === 'user'
                        ? (promptNumbers[interaction.id] ? `Student (${userLabel} ${promptNumbers[interaction.id]})` : 'Student')
                        : 'AI Assistant'}
                    </span>
                    <span className="text-gray-400">
                      {formatTimestamp(interaction.timestamp)}
                    </span>
                  </div>
                  <div className="text-gray-700 text-sm leading-relaxed">{interaction.content}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Existing Feedback */}
        {feedback && feedback.length > 0 && (
          <div className="bg-white rounded-lg p-5 shadow-sm">
            <h2 className="text-lg font-bold text-surface-dark mb-3 pb-2 border-b-2 border-gray-100 flex items-center gap-2">
              <History className="w-5 h-5 text-primary-500" />
              Previous Feedback
            </h2>
            <div className="space-y-3">
              {feedback.map((fb) => (
                <div key={fb.id} className="p-3 bg-gray-50 rounded-lg border-l-4 border-primary-500">
                  <div className="flex justify-between items-center mb-1.5">
                    <div className="text-sm">
                      <strong>{fb.instructor_name}</strong>
                      <span className="text-gray-400 ml-2">{formatDate(fb.created_at)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {fb.rating && (
                        <span className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((v) => (
                            <Star
                              key={v}
                              className={`w-4 h-4 ${v <= fb.rating ? 'text-warning fill-warning' : 'text-gray-300'}`}
                            />
                          ))}
                        </span>
                      )}
                      {fb.flagged && (
                        <span className="bg-danger text-white px-2 py-0.5 rounded text-xs font-semibold uppercase inline-flex items-center gap-1">
                          <Flag className="w-3 h-3" />
                          Flagged
                        </span>
                      )}
                      <button
                        onClick={() => handleDeleteFeedback(fb.id)}
                        className="border border-danger text-danger px-2 py-0.5 rounded text-xs hover:bg-danger hover:text-white transition-colors inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="text-gray-700 text-sm leading-relaxed">{fb.feedback_text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Grade Submissions */}
        {gradeSubmissions && gradeSubmissions.length > 0 && (
          <div className="bg-white rounded-lg p-5 shadow-sm">
            <h2 className="text-lg font-bold text-surface-dark mb-3 pb-2 border-b-2 border-gray-100 flex items-center gap-2">
              <History className="w-5 h-5 text-primary-500" />
              Grade Submission History
            </h2>
            <div className="space-y-2">
              {gradeSubmissions.map((submission, idx) => (
                <div key={submission.id} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg flex-wrap">
                  <span className="font-bold text-success text-lg">{submission.score}%</span>
                  <span className={`px-3 py-0.5 rounded-full text-xs font-semibold ${
                    PASSBACK_BADGES[submission.status]?.cls || 'bg-amber-100 text-amber-800'
                  }`}>
                    {PASSBACK_BADGES[submission.status]?.label || submission.status}
                  </span>
                  {Number(submission.attempt_count) > 1 && (
                    <span className="text-gray-400 text-xs">{submission.attempt_count} attempts</span>
                  )}
                  <span className="text-gray-400 text-sm">{formatDate(submission.submitted_at || submission.last_attempt_at)}</span>
                  {submission.status === 'pending_retry' && submission.next_attempt_at && (
                    <span className="text-amber-600 text-xs">next attempt {formatDate(submission.next_attempt_at)}</span>
                  )}
                  {submission.error_message && (
                    <span className="text-danger text-sm flex-1">{submission.error_message}</span>
                  )}
                  {idx === 0 && ['failed', 'failed_permanent', 'pending_retry', 'retrying'].includes(submission.status) && (
                    <button
                      onClick={handleRetryGrade}
                      disabled={retryingGrade}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-lg bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${retryingGrade ? 'animate-spin' : ''}`} />
                      {retryingGrade ? 'Retrying...' : 'Retry now'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {exemplarModalOpen && (
        <SaveExemplarModal
          session={session}
          interactions={interactions}
          criteriaEvaluations={criteriaEvaluations}
          scoringEnabled={scoringEnabled}
          onClose={() => setExemplarModalOpen(false)}
          onSaved={(count) => {
            showToast(`Saved ${count} exemplar${count === 1 ? '' : 's'} to assignment rubric`, 'success')
            setExemplarModalOpen(false)
          }}
        />
      )}
    </div>
  )
}

function SaveExemplarModal({ session, interactions, criteriaEvaluations, scoringEnabled, onClose, onSaved }) {
  const { showToast } = useToast()
  const rubric = session.assignment_rubric || []
  const [selected, setSelected] = useState(() => {
    // Default-select criteria the student scored well on (top level)
    const init = {}
    rubric.forEach((c) => {
      const evalEntry = criteriaEvaluations.find((e) => e.id === c.id)
      if (evalEntry) {
        init[c.id] = {
          checked: false,
          label: evalEntry.level_achieved || '',
          score: scoringEnabled ? (evalEntry.score ?? '') : '',
          explanation: '',
        }
      } else {
        init[c.id] = { checked: false, label: '', score: '', explanation: '' }
      }
    })
    return init
  })
  const [saving, setSaving] = useState(false)

  const transcriptPreview = interactions
    .map((m) => `${m.role === 'user' ? 'Student' : 'AI'}: ${m.content}`)
    .join('\n\n')

  const toggleCriterion = (id) => {
    setSelected((prev) => ({ ...prev, [id]: { ...prev[id], checked: !prev[id].checked } }))
  }

  const updateField = (id, field, value) => {
    setSelected((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  const handleSave = async () => {
    const promotions = rubric
      .filter((c) => selected[c.id]?.checked)
      .map((c) => ({
        criterion_id: c.id,
        label: selected[c.id].label,
        score: selected[c.id].score === '' ? null : Number(selected[c.id].score),
        explanation: selected[c.id].explanation,
      }))

    if (promotions.length === 0) {
      showToast('Select at least one criterion to save', 'warning')
      return
    }

    try {
      setSaving(true)
      const response = await adminAPI.promoteSessionToExemplars(session.assignment_id, {
        session_id: session.id,
        promotions,
      })
      onSaved(response.data.added_count || promotions.length)
    } catch (err) {
      console.error('Error saving exemplars:', err)
      showToast(err.response?.data?.error || 'Failed to save exemplars', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-surface-dark flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            Save Session as Exemplar
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <p className="text-sm text-gray-600">
            Promoting this session's transcript to one or more rubric criteria will store it as a calibration anchor for future AI grading. The transcript will be visible to the grading model and to instructors — don't promote sessions containing identifying information.
          </p>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">Transcript preview</span>
            <pre className="text-xs text-gray-600 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
              {transcriptPreview.length > 5000 ? transcriptPreview.slice(0, 5000) + '\n…(truncated at 5000 chars)' : transcriptPreview}
            </pre>
          </div>

          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">Select criteria to calibrate</span>
            <div className="space-y-2">
              {rubric.map((c) => {
                const existing = (c.exemplars || []).length
                const atMax = existing >= 5
                const state = selected[c.id] || { checked: false, label: '', score: '', explanation: '' }
                return (
                  <div key={c.id} className={`border rounded-lg p-3 ${state.checked ? 'border-primary-400 bg-primary-50/30' : 'border-gray-200'}`}>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={state.checked}
                        disabled={atMax}
                        onChange={() => toggleCriterion(c.id)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-gray-800">{c.name}</span>
                          <span className="text-xs text-gray-400">{existing}/5 exemplars{atMax ? ' (full)' : ''}</span>
                        </div>
                        {c.description && <p className="text-xs text-gray-500 mt-0.5">{c.description}</p>}
                      </div>
                    </label>

                    {state.checked && (
                      <div className="mt-3 space-y-2 pl-6">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={state.label}
                            onChange={(e) => updateField(c.id, 'label', e.target.value)}
                            placeholder="Label (e.g. Exemplary)"
                            className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-sm focus:border-primary-500 focus:outline-none"
                          />
                          {scoringEnabled && (
                            <label className="flex items-center gap-1 text-xs text-gray-600">
                              <span className="whitespace-nowrap">Score:</span>
                              <input
                                type="number"
                                min="0"
                                value={state.score}
                                onChange={(e) => updateField(c.id, 'score', e.target.value)}
                                className="w-16 px-2 py-1.5 border border-gray-200 rounded text-sm text-center focus:border-primary-500 focus:outline-none"
                              />
                            </label>
                          )}
                        </div>
                        <textarea
                          value={state.explanation}
                          onChange={(e) => updateField(c.id, 'explanation', e.target.value.slice(0, 2000))}
                          placeholder="Why is this exemplary for this criterion? What should graders look for in similar responses?"
                          rows="3"
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:border-primary-500 focus:outline-none resize-y"
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-md font-medium hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm bg-amber-500 text-white rounded-md font-medium hover:bg-amber-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5"
          >
            <Sparkles className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save Exemplars'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default StudentSessionDetail
