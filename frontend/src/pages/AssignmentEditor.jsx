import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { adminAPI } from '../utils/api'
import { useToast } from '../components/Toast'
import RubricEditor from '../components/authoring/RubricEditor'
import CompletionConditionsEditor from '../components/authoring/CompletionConditionsEditor'
import AIConfigEditor from '../components/authoring/AIConfigEditor'
import PreviewChat from '../components/authoring/PreviewChat'
import LearningContentEditor from '../components/authoring/LearningContentEditor'
import StagesEditor from '../components/authoring/StagesEditor'
import ArtifactConfigEditor from '../components/authoring/ArtifactConfigEditor'
import QuestionAreasEditor from '../components/authoring/QuestionAreasEditor'
import { ArrowLeft, Save, FileText, UserCircle, ClipboardList, CheckSquare, Cpu, MessageSquare, Globe, EyeOff, BookOpen, Sparkles, Wand2, AlertTriangle, ClipboardCheck, Layers, PenLine } from 'lucide-react'

const SIMULATION_TABS = [
  { key: 'basics', label: 'Basics', Icon: FileText },
  { key: 'persona', label: 'AI Persona', Icon: UserCircle },
  { key: 'rubric', label: 'Rubric', Icon: ClipboardList },
  { key: 'completion', label: 'Completion', Icon: CheckSquare },
  { key: 'ai_config', label: 'AI Config', Icon: Cpu },
  { key: 'preview', label: 'Preview', Icon: MessageSquare },
]

const LLM_INTERACTION_TABS = [
  { key: 'basics', label: 'Basics', Icon: FileText },
  { key: 'learning_content', label: 'Learning Content', Icon: BookOpen },
  { key: 'ai_instructions', label: 'AI Instructions', Icon: Sparkles },
  { key: 'rubric', label: 'Tasks', Icon: ClipboardList },
  { key: 'completion', label: 'Completion', Icon: CheckSquare },
  { key: 'ai_config', label: 'AI Config', Icon: Cpu },
  { key: 'preview', label: 'Preview', Icon: MessageSquare },
]

const STAGED_TABS = [
  { key: 'basics', label: 'Basics', Icon: FileText },
  { key: 'persona', label: 'AI Persona', Icon: UserCircle },
  { key: 'stages', label: 'Stages', Icon: Layers },
  { key: 'rubric', label: 'Rubric', Icon: ClipboardList },
  { key: 'completion', label: 'Completion', Icon: CheckSquare },
  { key: 'ai_config', label: 'AI Config', Icon: Cpu },
  { key: 'preview', label: 'Preview', Icon: MessageSquare },
]

const ARTIFACT_TABS = [
  { key: 'basics', label: 'Basics', Icon: FileText },
  { key: 'persona', label: 'AI Persona', Icon: UserCircle },
  { key: 'artifact', label: 'Artifact', Icon: PenLine },
  { key: 'rubric', label: 'Rubric', Icon: ClipboardList },
  { key: 'completion', label: 'Completion', Icon: CheckSquare },
  { key: 'ai_config', label: 'AI Config', Icon: Cpu },
  { key: 'preview', label: 'Preview', Icon: MessageSquare },
]

const EXAMINER_TABS = [
  { key: 'basics', label: 'Basics', Icon: FileText },
  { key: 'persona', label: 'AI Persona', Icon: UserCircle },
  { key: 'questions', label: 'Questions', Icon: MessageSquare },
  { key: 'rubric', label: 'Rubric', Icon: ClipboardList },
  { key: 'completion', label: 'Completion', Icon: CheckSquare },
  { key: 'ai_config', label: 'AI Config', Icon: Cpu },
  { key: 'preview', label: 'Preview', Icon: MessageSquare },
]

const TYPE_LABELS = {
  simulation: 'Simulation',
  llm_interaction: 'LLM Interaction',
  staged_simulation: 'Staged Simulation',
  simulation_with_artifact: 'Simulation + Write-up',
  ai_examiner: 'AI Examiner',
}

function AssignmentEditor({ ltik, user }) {
  const { assignmentId } = useParams()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const isEditing = !!assignmentId

  const requestedType = searchParams.get('type')
  const initialType = ['llm_interaction', 'staged_simulation', 'simulation_with_artifact', 'ai_examiner'].includes(requestedType)
    ? requestedType
    : 'simulation'

  const [activeTab, setActiveTab] = useState('basics')
  const [loading, setLoading] = useState(isEditing)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState(assignmentId || null)

  const [form, setForm] = useState({
    title: '',
    description: '',
    welcome_message: '',
    is_published: false,
    persona_name: '',
    persona_description: '',
    system_prompt: '',
    scenario_context: '',
    rubric: [],
    completion_conditions: {},
    ai_provider_config: {},
    max_score: 100,
    scoring_enabled: true,
    max_sessions: 1,
    feedback_release_mode: 'immediate',
    assignment_type: initialType,
    learning_content: { html: '', title: '' },
    allow_practice: false,
    stages: null,
    artifact_config: null,
    examiner_config: null,
    voice_config: null,
  })

  const tabs = form.assignment_type === 'llm_interaction' ? LLM_INTERACTION_TABS
    : form.assignment_type === 'staged_simulation' ? STAGED_TABS
    : form.assignment_type === 'simulation_with_artifact' ? ARTIFACT_TABS
    : form.assignment_type === 'ai_examiner' ? EXAMINER_TABS
    : SIMULATION_TABS
  const isLLMInteraction = form.assignment_type === 'llm_interaction'

  // AI-generated draft handed over by CreateAssignmentModal via router state
  const [fromDraft, setFromDraft] = useState(false)
  const [refining, setRefining] = useState(null)
  const [critique, setCritique] = useState(null)
  const [critiquing, setCritiquing] = useState(false)
  const [testTranscript, setTestTranscript] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (isEditing) {
      loadAssignment()
    } else if (location.state?.draft) {
      const d = location.state.draft
      setForm((prev) => ({
        ...prev,
        ...d,
        learning_content: d.learning_content || prev.learning_content,
      }))
      setFromDraft(true)
    }
  }, [assignmentId])

  const handleRefine = async (field, label) => {
    const instruction = window.prompt(
      `AI refine: ${label}\n\nOptional instruction (e.g. "make her more reluctant to share details"). Leave blank to simply improve it.`,
      ''
    )
    if (instruction === null) return
    try {
      setRefining(field)
      const res = await adminAPI.refineField(form, field, instruction || undefined)
      updateField(field, res.data.value)
      showToast('Field rewritten — review the new text', 'success')
    } catch (err) {
      showToast(err.response?.data?.error || 'Refine failed', 'error')
    } finally {
      setRefining(null)
    }
  }

  const RefineButton = ({ field, label }) => (
    <button
      type="button"
      onClick={() => handleRefine(field, label)}
      disabled={refining !== null}
      className="text-xs text-primary-500 hover:text-primary-700 inline-flex items-center gap-1 disabled:opacity-50 font-medium"
      title="Rewrite this field with AI, using the rest of the assignment as context"
    >
      <Wand2 className="w-3 h-3" />
      {refining === field ? 'Refining…' : 'AI refine'}
    </button>
  )

  const handleCritique = async () => {
    try {
      setCritiquing(true)
      const res = await adminAPI.critiqueRubric({
        rubric: form.rubric,
        max_score: form.max_score,
        assignment_type: form.assignment_type,
        title: form.title,
        description: form.description,
      })
      setCritique(res.data.suggestions)
    } catch (err) {
      showToast(err.response?.data?.error || 'Critique failed', 'error')
    } finally {
      setCritiquing(false)
    }
  }

  const handleTestGrade = async () => {
    try {
      setTesting(true)
      setTestResult(null)
      const res = await adminAPI.testGrade(savedId, testTranscript)
      setTestResult(res.data)
    } catch (err) {
      showToast(err.response?.data?.error || 'Test grading failed', 'error')
    } finally {
      setTesting(false)
    }
  }

  const loadAssignment = async () => {
    try {
      const response = await adminAPI.getAssignment(assignmentId)
      const a = response.data.assignment
      setForm({
        title: a.title || '',
        description: a.description || '',
        welcome_message: a.welcome_message || '',
        is_published: a.is_published !== false,
        persona_name: a.persona_name || '',
        persona_description: a.persona_description || '',
        system_prompt: a.system_prompt || '',
        scenario_context: a.scenario_context || '',
        rubric: a.rubric || [],
        completion_conditions: a.completion_conditions || {},
        ai_provider_config: a.ai_provider_config || {},
        max_score: a.max_score || 100,
        scoring_enabled: a.scoring_enabled !== false,
        max_sessions: a.max_sessions != null ? a.max_sessions : 1,
        feedback_release_mode: a.feedback_release_mode || 'immediate',
        assignment_type: a.assignment_type || 'simulation',
        learning_content: a.learning_content || { html: '', title: '' },
        allow_practice: a.allow_practice === true,
        stages: a.stages || null,
        artifact_config: a.artifact_config || null,
        examiner_config: a.examiner_config || null,
        voice_config: a.voice_config || null,
      })
      setSavedId(a.id)
    } catch (err) {
      showToast('Failed to load assignment', 'error')
    } finally {
      setLoading(false)
    }
  }

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    if (!form.title.trim()) {
      showToast('Title is required', 'warning')
      return
    }

    try {
      setSaving(true)
      let result
      if (isEditing || savedId) {
        result = await adminAPI.updateAssignment(savedId || assignmentId, form)
        showToast('Assignment updated', 'success')

        // If the rubric changed and there are pending-review drafts, offer to
        // regrade them with the new rubric. Released grades are never touched.
        const { pending_review_count, rubric_changed } = result.data || {}
        if (rubric_changed && pending_review_count > 0) {
          const ok = confirm(
            `${pending_review_count} pending-review ${pending_review_count === 1 ? 'session was' : 'sessions were'} graded before your rubric changes.\n\n` +
            `Regrade ${pending_review_count === 1 ? 'it' : 'them'} now with the current rubric? This updates the AI draft only — released grades are not affected, and nothing is sent to Canvas until you release.`
          )
          if (ok) {
            try {
              const regradeResult = await adminAPI.regradePendingForAssignment(savedId || assignmentId)
              const { succeeded, failed } = regradeResult.data
              if (failed > 0) {
                showToast(`Regraded ${succeeded}, ${failed} failed — check logs`, 'warning')
              } else {
                showToast(`Regraded ${succeeded} pending ${succeeded === 1 ? 'session' : 'sessions'}`, 'success')
              }
            } catch (err) {
              console.error('Bulk regrade failed:', err)
              showToast('Bulk regrade failed', 'error')
            }
          }
        }
      } else {
        result = await adminAPI.createAssignment(form)
        const newId = result.data.assignment.id
        setSavedId(newId)
        showToast('Assignment created', 'success')
        // Update URL without full reload
        window.history.replaceState(null, '', `/admin/assignments/${newId}/edit`)
      }
    } catch (err) {
      showToast('Failed to save assignment', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center">
        <div className="loading-spinner" />
        <p className="mt-4 text-gray-500">Loading assignment...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-surface-darker text-white py-4 px-6 shadow-md flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/admin')}
            className="text-white/80 hover:text-white font-medium text-sm inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <h1 className="text-xl font-bold">
            {isEditing ? 'Edit Assignment' : 'New Assignment'}
          </h1>
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-white/15 text-white inline-flex items-center gap-1.5">
            {isLLMInteraction ? <Sparkles className="w-3.5 h-3.5" /> : <UserCircle className="w-3.5 h-3.5" />}
            {TYPE_LABELS[form.assignment_type] || 'Simulation'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => updateField('is_published', !form.is_published)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold inline-flex items-center gap-1.5 transition-colors ${
              form.is_published
                ? 'bg-green-500/20 text-green-300 hover:bg-green-500/30'
                : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
            }`}
          >
            {form.is_published ? (
              <><Globe className="w-4 h-4" /> Published</>
            ) : (
              <><EyeOff className="w-4 h-4" /> Draft</>
            )}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-gradient-to-br from-primary-500 to-primary-700 text-white rounded-lg font-semibold text-sm shadow-md hover:-translate-y-0.5 hover:shadow-lg transition-all disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </header>

      <div className="flex-1 max-w-5xl w-full mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="flex gap-1 bg-white rounded-lg p-1 shadow-sm mb-6 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors inline-flex items-center gap-1.5 ${
                activeTab === tab.key
                  ? 'bg-primary-500 text-white'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              <tab.Icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          {fromDraft && (
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
              <Wand2 className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                This is an AI-generated draft. Review every tab — especially the rubric — and test it in Preview before publishing. Nothing is saved until you click Save.
              </p>
            </div>
          )}

          {activeTab === 'basics' && (
            <div className="space-y-4 max-w-2xl">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700">Title *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => updateField('title', e.target.value)}
                  placeholder="Assignment title"
                  className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-gray-700">Description</label>
                  <RefineButton field="description" label="Description" />
                </div>
                <textarea
                  value={form.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  placeholder="Brief description visible to students"
                  rows="3"
                  className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none resize-y"
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-gray-700">Welcome Message</label>
                  <RefineButton field="welcome_message" label="Welcome Message" />
                </div>
                <textarea
                  value={form.welcome_message}
                  onChange={(e) => updateField('welcome_message', e.target.value)}
                  placeholder="Initial message shown when the student starts (sent as the AI's first message)"
                  rows="3"
                  className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none resize-y"
                />
              </div>
              {form.scoring_enabled && (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold text-gray-700">Max Score</label>
                  <input
                    type="number"
                    min="1"
                    value={form.max_score}
                    onChange={(e) => updateField('max_score', parseInt(e.target.value) || 100)}
                    className="w-32 px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none"
                  />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700">Max Attempts</label>
                <input
                  type="number"
                  min="1"
                  value={form.max_sessions ?? ''}
                  onChange={(e) => {
                    const val = e.target.value
                    updateField('max_sessions', val === '' ? null : parseInt(val) || 1)
                  }}
                  placeholder="Unlimited"
                  className="w-32 px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none"
                />
                <span className="text-xs text-gray-400">Leave blank for unlimited attempts</span>
              </div>
            </div>
          )}

          {activeTab === 'learning_content' && isLLMInteraction && (
            <div className="space-y-4">
              <div className="flex flex-col gap-1 max-w-2xl">
                <label className="text-sm font-semibold text-gray-700">Panel Title</label>
                <input
                  type="text"
                  value={form.learning_content?.title || ''}
                  onChange={(e) => updateField('learning_content', { ...(form.learning_content || {}), title: e.target.value })}
                  placeholder='e.g. "Lesson: Writing Effective Prompts"'
                  className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none"
                />
                <span className="text-xs text-gray-400">Shown at the top of the side panel students open while chatting.</span>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700">Lesson Content</label>
                <span className="text-xs text-gray-400">
                  Rich text supported: headings, lists, links, images, YouTube/Vimeo videos, and embeds (CodePen, H5P, etc.).
                </span>
                <LearningContentEditor
                  content={form.learning_content || { html: '', title: '' }}
                  onChange={(lc) => updateField('learning_content', lc)}
                />
              </div>
            </div>
          )}

          {activeTab === 'ai_instructions' && isLLMInteraction && (
            <div className="space-y-4 max-w-2xl">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-gray-700">AI Instructions</label>
                  <RefineButton field="system_prompt" label="AI Instructions" />
                </div>
                <span className="text-xs text-gray-400">
                  Optional system prompt sent to the LLM for every message in this activity. Leave blank for a default helpful-assistant prompt.
                </span>
                <textarea
                  value={form.system_prompt}
                  onChange={(e) => updateField('system_prompt', e.target.value)}
                  placeholder="e.g. 'You are a finance tutor. Help the student build a discounted cash flow model. Do not give them the final answer; guide them with questions.'"
                  rows="14"
                  className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none resize-y font-mono text-sm"
                />
              </div>
            </div>
          )}

          {activeTab === 'persona' && !isLLMInteraction && (
            <div className="space-y-4 max-w-2xl">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700">Persona Name</label>
                <input
                  type="text"
                  value={form.persona_name}
                  onChange={(e) => updateField('persona_name', e.target.value)}
                  placeholder='e.g. "Dr. Sarah Chen" or "Frustrated Customer"'
                  className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-gray-700">Persona Background</label>
                  <RefineButton field="persona_description" label="Persona Background" />
                </div>
                <textarea
                  value={form.persona_description}
                  onChange={(e) => updateField('persona_description', e.target.value)}
                  placeholder="Describe who this persona is — their role, personality, history, and how they should come across in conversation"
                  rows="12"
                  className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none resize-y"
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-gray-700">Scenario / Setting</label>
                  <RefineButton field="scenario_context" label="Scenario / Setting" />
                </div>
                <textarea
                  value={form.scenario_context}
                  onChange={(e) => updateField('scenario_context', e.target.value)}
                  placeholder="Describe the situation the student is entering. What's happening, where, and why?"
                  rows="12"
                  className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none resize-y"
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-gray-700">Additional AI Instructions</label>
                  <RefineButton field="system_prompt" label="Additional AI Instructions" />
                </div>
                <span className="text-xs text-gray-400">
                  Optional: extra rules or constraints for how the AI should behave
                </span>
                <textarea
                  value={form.system_prompt}
                  onChange={(e) => updateField('system_prompt', e.target.value)}
                  placeholder="Any specific behavioral rules, response style guidelines, or constraints..."
                  rows="12"
                  className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none resize-y"
                />
              </div>
            </div>
          )}

          {activeTab === 'stages' && form.assignment_type === 'staged_simulation' && (
            <StagesEditor
              stages={form.stages}
              onChange={(stages) => updateField('stages', stages)}
            />
          )}

          {activeTab === 'artifact' && form.assignment_type === 'simulation_with_artifact' && (
            <ArtifactConfigEditor
              config={form.artifact_config}
              onChange={(cfg) => updateField('artifact_config', cfg)}
            />
          )}

          {activeTab === 'questions' && form.assignment_type === 'ai_examiner' && (
            <QuestionAreasEditor
              config={form.examiner_config}
              onChange={(cfg) => updateField('examiner_config', cfg)}
            />
          )}

          {activeTab === 'rubric' && (
            <div className="space-y-4">
              {(() => {
                const sum = form.rubric.reduce((acc, c) => acc + (Number(c.max_points) || 0), 0)
                const mismatch = form.scoring_enabled && form.rubric.length > 0 && sum !== Number(form.max_score)
                return (
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    {form.scoring_enabled && form.rubric.length > 0 ? (
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium inline-flex items-center gap-1 ${
                        mismatch ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-700'
                      }`}>
                        {mismatch && <AlertTriangle className="w-3.5 h-3.5" />}
                        Criteria points: {sum} of {form.max_score} max score{mismatch && ' — adjust points or the Max Score on Basics'}
                      </span>
                    ) : <span />}
                    {form.rubric.length > 0 && (
                      <button
                        type="button"
                        onClick={handleCritique}
                        disabled={critiquing}
                        className="text-xs text-primary-500 hover:text-primary-700 inline-flex items-center gap-1 disabled:opacity-50 font-medium"
                        title="AI audit: observable levels, distinguishable bands, overlap, coverage"
                      >
                        <ClipboardCheck className="w-3.5 h-3.5" />
                        {critiquing ? 'Reviewing…' : 'AI rubric review'}
                      </button>
                    )}
                  </div>
                )
              })()}
              {critique !== null && (
                <div className="bg-primary-50/50 border border-primary-100 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-primary-700">Rubric review</span>
                    <button type="button" onClick={() => setCritique(null)} className="text-xs text-gray-400 hover:text-gray-600">dismiss</button>
                  </div>
                  {critique.length === 0 ? (
                    <p className="text-sm text-gray-600">No issues found — the rubric looks solid.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {critique.map((s, i) => (
                        <li key={i} className="text-sm text-gray-700">
                          {s.criterion && <span className="font-semibold">{s.criterion}: </span>}
                          {s.issue} <span className="text-gray-500">— {s.suggestion}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <RubricEditor
                rubric={form.rubric}
                onChange={(rubric) => updateField('rubric', rubric)}
                scoringEnabled={form.scoring_enabled}
                onScoringEnabledChange={(val) => updateField('scoring_enabled', val)}
                criteriaLabel={isLLMInteraction ? 'Task' : 'Criterion'}
                stages={form.assignment_type === 'staged_simulation' ? form.stages : null}
                showAppliesTo={form.assignment_type === 'simulation_with_artifact'}
                questionAreas={form.assignment_type === 'ai_examiner' ? form.examiner_config?.question_areas : null}
              />
            </div>
          )}

          {activeTab === 'completion' && (
            <div className="space-y-6">
              <CompletionConditionsEditor
                conditions={form.completion_conditions}
                onChange={(conditions) => updateField('completion_conditions', conditions)}
              />

              <div className="border-t border-gray-200 pt-6">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.allow_practice === true}
                    onChange={(e) => updateField('allow_practice', e.target.checked)}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700">Allow practice sessions</span>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Students get a "Practice first" option: a short ungraded run (capped at 10 messages) with
                      immediate AI feedback. Practice never uses an attempt, never reaches the gradebook, and is
                      excluded from your statistics. Practice chats still count toward your institution's AI usage.
                    </p>
                  </div>
                </label>
              </div>

              <div className="border-t border-gray-200 pt-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-1">Feedback Release</h3>
                <p className="text-xs text-gray-400 mb-3">Controls when students see their evaluation results after completing the simulation.</p>
                <div className="space-y-2">
                  <label className="flex items-start gap-3 p-3 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50"
                    style={{ borderColor: form.feedback_release_mode === 'immediate' ? 'var(--color-primary-500, #6366f1)' : '#e5e7eb' }}
                  >
                    <input
                      type="radio"
                      name="feedback_release_mode"
                      value="immediate"
                      checked={form.feedback_release_mode === 'immediate'}
                      onChange={() => updateField('feedback_release_mode', 'immediate')}
                      className="mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">Release immediately</span>
                      <p className="text-xs text-gray-400 mt-0.5">Students see their score and feedback as soon as they complete the simulation.</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 p-3 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50"
                    style={{ borderColor: form.feedback_release_mode === 'confidence_gated' ? 'var(--color-primary-500, #6366f1)' : '#e5e7eb' }}
                  >
                    <input
                      type="radio"
                      name="feedback_release_mode"
                      value="confidence_gated"
                      checked={form.feedback_release_mode === 'confidence_gated'}
                      onChange={() => updateField('feedback_release_mode', 'confidence_gated')}
                      className="mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">Immediate, but hold low-confidence for review <span className="text-xs font-normal text-amber-600">(experimental)</span></span>
                      <p className="text-xs text-gray-400 mt-0.5">The AI grader reports its confidence per criterion. Confident evaluations release immediately; sessions with any low-confidence criterion are held for your review. Confidence is self-reported by the AI — treat as experimental until the grading-accuracy data validates it.</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 p-3 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50"
                    style={{ borderColor: form.feedback_release_mode === 'instructor_review' ? 'var(--color-primary-500, #6366f1)' : '#e5e7eb' }}
                  >
                    <input
                      type="radio"
                      name="feedback_release_mode"
                      value="instructor_review"
                      checked={form.feedback_release_mode === 'instructor_review'}
                      onChange={() => updateField('feedback_release_mode', 'instructor_review')}
                      className="mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">Hold for instructor review</span>
                      <p className="text-xs text-gray-400 mt-0.5">AI evaluation is generated but held until you review and release results. Grades are sent to the gradebook upon release.</p>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ai_config' && (
            <div className="space-y-6">
              <AIConfigEditor
                config={form.ai_provider_config}
                onChange={(config) => updateField('ai_provider_config', config)}
              />
              {!isLLMInteraction && (
                <div className="border-t border-gray-200 pt-5 max-w-2xl">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.voice_config?.enabled === true}
                      onChange={(e) => updateField('voice_config', e.target.checked
                        ? { enabled: true, voice_id: form.voice_config?.voice_id || 'Joanna' }
                        : null)}
                      className="mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">Voice conversation</span>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Students can speak their messages (transcribed in the browser, editable before sending)
                        and hear the persona's replies read aloud. Typing always remains available — voice is
                        never required. Spoken replies need Amazon Polly access on the server; if unavailable,
                        students still get voice input and on-screen text.
                      </p>
                    </div>
                  </label>
                  {form.voice_config?.enabled && (
                    <label className="flex items-center gap-2 text-sm mt-3 ml-7">
                      <span className="text-gray-600">Persona voice:</span>
                      <select
                        value={form.voice_config?.voice_id || 'Joanna'}
                        onChange={(e) => updateField('voice_config', { enabled: true, voice_id: e.target.value })}
                        className="px-2 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-primary-500 focus:outline-none bg-white"
                      >
                        {['Joanna', 'Matthew', 'Ruth', 'Stephen', 'Danielle', 'Gregory', 'Ivy', 'Kimberly'].map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'preview' && (
            <div className="space-y-6">
              <PreviewChat
                assignmentId={savedId}
                saved={!!savedId}
                welcomeMessage={form.welcome_message}
              />

              {/* Grading dry-run: exercise the real evaluator before students do */}
              <div className="border border-gray-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
                  <ClipboardCheck className="w-4 h-4 text-primary-500" />
                  Test Grading
                </h3>
                <p className="text-xs text-gray-400 mb-3">
                  Paste a sample transcript (lines prefixed <code className="bg-gray-100 px-1 rounded">Student:</code> and <code className="bg-gray-100 px-1 rounded">AI:</code>) and grade it with the real evaluator
                  against your saved rubric. Nothing is recorded. {!savedId && 'Save the assignment first.'}
                </p>
                <textarea
                  value={testTranscript}
                  onChange={(e) => setTestTranscript(e.target.value)}
                  rows="6"
                  placeholder={'Student: Hi, I’m here to talk about your medications.\nAI: Oh, I have so many pills, I don’t know what half of them are for...\nStudent: Let’s go through them one at a time.'}
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none resize-y text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={handleTestGrade}
                  disabled={!savedId || testing || !testTranscript.trim()}
                  className="mt-2 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {testing ? 'Grading…' : 'Grade this transcript'}
                </button>
                {testResult && (
                  <div className="mt-4 bg-gray-50 rounded-lg p-3">
                    <p className="text-sm font-semibold text-gray-700 mb-2">
                      {testResult.evaluation.scoring_enabled !== false && testResult.evaluation.score != null
                        ? `Score: ${testResult.evaluation.score}/${form.max_score}`
                        : 'Scoreless evaluation'}
                      <span className="text-xs text-gray-400 font-normal"> · graded {testResult.parsed_messages} parsed messages</span>
                    </p>
                    {testResult.evaluation.overall_feedback && (
                      <p className="text-sm text-gray-600 mb-2">{testResult.evaluation.overall_feedback}</p>
                    )}
                    <div className="space-y-1.5">
                      {(testResult.evaluation.criteria_evaluations || []).map((c, i) => (
                        <div key={i} className="text-sm">
                          <span className="font-medium text-gray-700">{c.name}</span>
                          {c.level_achieved && <span className="text-gray-500"> — {c.level_achieved}</span>}
                          {c.score != null && <span className="text-gray-500"> ({c.score} pts)</span>}
                          {c.confidence && c.confidence !== 'high' && (
                            <span className="text-amber-600 text-xs"> · {c.confidence} confidence</span>
                          )}
                          {c.feedback && <p className="text-xs text-gray-500 mt-0.5">{c.feedback}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AssignmentEditor
