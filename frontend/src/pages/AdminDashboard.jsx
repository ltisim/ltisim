import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminAPI } from '../utils/api'
import AdminNav from '../components/AdminNav'
import CreateAssignmentModal from '../components/CreateAssignmentModal'
import { useToast } from '../components/Toast'
import { formatDate } from '../utils/format'
import { Plus, Inbox, BookOpen, Users, CheckSquare, BarChart3, ArrowRight, Clock, UserCircle, Sparkles, Copy, Download, X } from 'lucide-react'

// Assignments overview. Sessions, analytics, students, and the review queue
// live on their own routes (see App.jsx /admin/* routes).
function AdminDashboard({ user }) {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [assignments, setAssignments] = useState([])
  const [course, setCourse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  // First-run card: sample templates + install state
  const [starterTemplates, setStarterTemplates] = useState(null)
  const [installingTemplate, setInstallingTemplate] = useState(null)
  // Duplicate flow: which assignment is being duplicated + target course choice
  const [duplicating, setDuplicating] = useState(null)
  const [myCourses, setMyCourses] = useState(null)
  const [duplicateTarget, setDuplicateTarget] = useState('')
  const [duplicateBusy, setDuplicateBusy] = useState(false)

  // Load the sample-template gallery only for the empty state.
  useEffect(() => {
    if (!loading && assignments.length === 0 && starterTemplates === null) {
      adminAPI.listTemplates()
        .then((res) => setStarterTemplates(res.data.templates || []))
        .catch(() => setStarterTemplates([]))
    }
  }, [loading, assignments, starterTemplates])

  const handleInstallTemplate = async (template) => {
    setInstallingTemplate(template.id)
    try {
      const res = await adminAPI.createFromTemplate(template.id)
      showToast('Sample assignment installed as a draft — look it over, then publish', 'success')
      navigate(`/admin/assignments/${res.data.assignment.id}/edit`)
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to install sample', 'error')
    } finally {
      setInstallingTemplate(null)
    }
  }

  const openDuplicate = (assignment) => {
    setDuplicating(assignment)
    setDuplicateTarget('')
    if (myCourses === null) {
      adminAPI.getMyCourses()
        .then((res) => setMyCourses(res.data.courses))
        .catch(() => setMyCourses([]))
    }
  }

  const handleDuplicate = async () => {
    try {
      setDuplicateBusy(true)
      const res = await adminAPI.duplicateAssignment(duplicating.id, duplicateTarget || undefined)
      if (res.data.copied_to_other_course) {
        showToast('Copied to the selected course as a draft', 'success')
      } else {
        showToast('Assignment duplicated (draft)', 'success')
        loadData()
      }
      setDuplicating(null)
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to duplicate assignment', 'error')
    } finally {
      setDuplicateBusy(false)
    }
  }

  const handleExport = async (assignment) => {
    try {
      const res = await adminAPI.exportAssignment(assignment.id)
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${assignment.title.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60)}.ltisim.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      showToast('Failed to export assignment', 'error')
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [assignmentsResponse, courseResponse] = await Promise.all([
        adminAPI.getAssignments(),
        adminAPI.getCourse(),
      ])
      setAssignments(assignmentsResponse.data.assignments)
      setCourse(courseResponse.data.course)
      setError(null)
    } catch (err) {
      console.error('Error loading admin data:', err)
      setError('Failed to load dashboard data. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const totalPending = assignments.reduce((acc, a) => acc + (Number(a.pending_review_count) || 0), 0)

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-100 items-center justify-center">
        <div className="loading-spinner" />
        <p className="mt-4 text-gray-500">Loading dashboard...</p>
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
      <AdminNav course={course} user={user} pendingCount={totalPending} />

      <div className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-5">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <h3 className="text-2xl font-bold text-surface-dark">Assignments</h3>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="px-6 py-3 bg-gradient-to-br from-primary-500 to-surface-dark text-white rounded-lg font-semibold shadow-md hover:-translate-y-0.5 hover:shadow-lg transition-all flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Create New Assignment
          </button>
        </div>

        {assignments.length === 0 ? (
          <div className="max-w-3xl mx-auto w-full py-8">
            <div className="bg-white rounded-2xl shadow-md border border-gray-200 p-8">
              <h3 className="text-xl font-bold text-surface-dark mb-1">Welcome to LTISim</h3>
              <p className="text-gray-500 text-sm mb-6">
                Your course is connected. Here&rsquo;s how instructors usually get from zero to a graded AI assignment:
              </p>
              <ol className="space-y-4 mb-8">
                <li className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                  <div>
                    <div className="font-semibold text-surface-dark text-sm">Create an assignment</div>
                    <div className="text-gray-500 text-sm">Describe it in a couple of sentences and the AI drafts the persona, scenario, and rubric — or start from a blank editor.</div>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                  <div>
                    <div className="font-semibold text-surface-dark text-sm">Try it before students do</div>
                    <div className="text-gray-500 text-sm">Preview the conversation and test-grade a sample transcript from inside the editor, before publishing anything.</div>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                  <div>
                    <div className="font-semibold text-surface-dark text-sm">Publish and review</div>
                    <div className="text-gray-500 text-sm">Students launch it from this course. Every AI evaluation cites the messages behind each score, and you can review, edit, or regrade before anything reaches the gradebook.</div>
                  </div>
                </li>
              </ol>

              <div className="flex flex-wrap items-center gap-3 mb-2">
                <button
                  onClick={() => setCreateModalOpen(true)}
                  className="px-5 py-2.5 bg-gradient-to-br from-primary-500 to-surface-dark text-white rounded-lg font-semibold shadow-md hover:-translate-y-0.5 hover:shadow-lg transition-all flex items-center gap-2 text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Create New Assignment
                </button>
                <span className="text-gray-400 text-sm">or install a working sample:</span>
              </div>

              {starterTemplates === null ? (
                <p className="text-gray-400 text-sm">Loading samples…</p>
              ) : starterTemplates.length === 0 ? (
                <p className="text-gray-400 text-sm">No sample assignments are available yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {starterTemplates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleInstallTemplate(t)}
                      disabled={installingTemplate !== null}
                      className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:border-primary-400 hover:text-primary-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {installingTemplate === t.id ? 'Installing…' : t.title}
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-gray-400">Samples install as unpublished drafts in this course — nothing is visible to students until you publish.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {assignments.map((assignment) => {
              const isLLM = assignment.assignment_type === 'llm_interaction'
              const headerGradient = isLLM ? 'from-teal-500 to-teal-700' : 'from-primary-500 to-surface-dark'
              const hoverBorder = isLLM ? 'hover:border-teal-500' : 'hover:border-primary-500'
              const accentText = isLLM ? 'text-teal-600' : 'text-primary-500'
              const editClass = isLLM
                ? 'bg-teal-100 text-teal-700 hover:bg-teal-200'
                : 'bg-primary-100 text-primary-700 hover:bg-primary-200'
              return (
                <div
                  key={assignment.id}
                  className={`bg-white rounded-xl shadow-md border-2 hover:-translate-y-1 transition-all cursor-pointer overflow-hidden flex flex-col ${
                    assignment.is_published === false
                      ? 'border-amber-300 opacity-90 hover:border-amber-400'
                      : `border-transparent ${hoverBorder}`
                  }`}
                  onClick={() => navigate(`/admin/assignments/${assignment.id}/sessions`)}
                >
                  <div className={`p-5 text-white bg-gradient-to-br ${headerGradient}`}>
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-semibold text-lg">{assignment.title}</h4>
                      <div className="flex gap-1.5 flex-wrap justify-end">
                        <span className="px-2 py-0.5 bg-white/20 text-white rounded-full text-xs font-semibold inline-flex items-center gap-1">
                          {isLLM ? <Sparkles className="w-3 h-3" /> : <UserCircle className="w-3 h-3" />}
                          {isLLM ? 'LLM Interaction' : 'Simulation'}
                        </span>
                        {assignment.is_published === false ? (
                          <span className="px-2 py-0.5 bg-amber-400 text-amber-900 rounded-full text-xs font-semibold">Draft</span>
                        ) : (
                          <span className="px-2 py-0.5 bg-green-400 text-green-900 rounded-full text-xs font-semibold">Published</span>
                        )}
                        {Number(assignment.pending_review_count) > 0 && (
                          <span className="px-2 py-0.5 bg-amber-400 text-amber-900 rounded-full text-xs font-semibold flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {assignment.pending_review_count} pending
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-sm text-white/80 mt-1 block">
                      Created: {formatDate(assignment.created_at)}
                    </span>
                    {!isLLM && assignment.persona_name && (
                      <span className="text-sm text-white/70 block mt-0.5">
                        Persona: {assignment.persona_name}
                      </span>
                    )}
                    {isLLM && (
                      <span className="text-sm text-white/70 block mt-0.5">
                        Open chat with learning content
                      </span>
                    )}
                  </div>
                  <div className="p-5 flex-1">
                    <p className="text-gray-500 text-sm leading-relaxed line-clamp-5">
                      {assignment.description || 'No description provided'}
                    </p>
                  </div>
                  <div className="px-5 pb-5">
                    <div className="grid grid-cols-4 gap-3 pt-3 border-t border-gray-100">
                      {[
                        { value: assignment.session_count || 0, label: 'Sessions', Icon: BookOpen },
                        { value: assignment.unique_students || 0, label: 'Students', Icon: Users },
                        { value: assignment.completed_count || 0, label: 'Done', Icon: CheckSquare },
                        { value: assignment.avg_score ? `${assignment.avg_score}%` : 'N/A', label: 'Avg', Icon: BarChart3 },
                      ].map((stat) => (
                        <div key={stat.label} className="text-center">
                          <stat.Icon className="w-4 h-4 text-gray-300 mx-auto mb-1" />
                          <strong className={`block text-xl ${accentText}`}>{stat.value}</strong>
                          <span className="text-xs text-gray-400 uppercase tracking-wide">{stat.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between mt-auto">
                    <span className={`font-semibold text-sm flex items-center gap-1 ${accentText}`}>
                      View sessions <ArrowRight className="w-4 h-4" />
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); openDuplicate(assignment) }}
                        title="Duplicate (this course or another you teach)"
                        className="p-1.5 text-xs rounded-md transition-colors bg-gray-100 text-gray-600 hover:bg-gray-200"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleExport(assignment) }}
                        title="Export as a shareable .ltisim.json file"
                        className="p-1.5 text-xs rounded-md transition-colors bg-gray-100 text-gray-600 hover:bg-gray-200"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/admin/assignments/${assignment.id}/analytics`)
                        }}
                        className="px-3 py-1.5 text-xs rounded-md font-medium transition-colors bg-gray-100 text-gray-600 hover:bg-gray-200 inline-flex items-center gap-1"
                      >
                        <BarChart3 className="w-3.5 h-3.5" />
                        Analytics
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/admin/assignments/${assignment.id}/edit`)
                        }}
                        className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${editClass}`}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <CreateAssignmentModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSelect={(type) => {
          setCreateModalOpen(false)
          navigate(`/admin/assignments/new?type=${type}`)
        }}
        onDraft={(draft) => {
          setCreateModalOpen(false)
          navigate(`/admin/assignments/new?type=${draft.assignment_type}`, { state: { draft } })
        }}
        onCreated={(assignment) => {
          setCreateModalOpen(false)
          navigate(`/admin/assignments/${assignment.id}/edit`)
        }}
      />

      {duplicating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDuplicating(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setDuplicating(null)} className="absolute top-3 right-3 p-1.5 rounded hover:bg-gray-100 text-gray-400">
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-bold text-surface-dark mb-1">Duplicate "{duplicating.title}"</h2>
            <p className="text-sm text-gray-500 mb-4">Creates an unpublished draft copy. Exemplar session links are not copied.</p>
            <label className="text-sm font-semibold text-gray-700 block mb-1">Destination course</label>
            <select
              value={duplicateTarget}
              onChange={(e) => setDuplicateTarget(e.target.value)}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none bg-white text-sm mb-4"
            >
              <option value="">This course</option>
              {(myCourses || [])
                .filter((c) => c.lti_context_id !== (course?.lti_context_id))
                .map((c) => <option key={c.id} value={c.lti_context_id}>{c.name}</option>)}
            </select>
            <button
              onClick={handleDuplicate}
              disabled={duplicateBusy}
              className="px-5 py-2 bg-primary-500 text-white rounded-lg font-semibold hover:bg-primary-600 disabled:opacity-50 transition-colors"
            >
              {duplicateBusy ? 'Duplicating…' : 'Duplicate'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminDashboard
