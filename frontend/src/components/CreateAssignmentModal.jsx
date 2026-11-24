import React, { useState, useEffect, useRef } from 'react'
import { adminAPI } from '../utils/api'
import { useToast } from './Toast'
import { UserCircle, Sparkles, X, Wand2, LayoutTemplate, Upload, ArrowLeft, Layers, GraduationCap, FileText } from 'lucide-react'

// Entry point for new assignments: start blank, generate a draft from a
// description, start from a curated template, or import an exported file.
// onSelect(type) → blank editor; onDraft(draft) → editor prefilled;
// onCreated(assignment) → navigate straight to editing the created draft.
function CreateAssignmentModal({ open, onClose, onSelect, onDraft, onCreated }) {
  const { showToast } = useToast()
  const [mode, setMode] = useState('choose') // choose | describe | templates
  const [describeType, setDescribeType] = useState('simulation')
  const [description, setDescription] = useState('')
  const [generating, setGenerating] = useState(false)
  const [templates, setTemplates] = useState(null)
  const [creatingFrom, setCreatingFrom] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (open) setMode('choose')
  }, [open])

  useEffect(() => {
    if (mode === 'templates' && templates === null) {
      adminAPI.listTemplates()
        .then((res) => setTemplates(res.data.templates))
        .catch(() => setTemplates([]))
    }
  }, [mode, templates])

  if (!open) return null

  const handleGenerate = async () => {
    try {
      setGenerating(true)
      const res = await adminAPI.generateDraft(description, describeType)
      onDraft(res.data.draft)
    } catch (err) {
      showToast(err.response?.data?.error || 'Draft generation failed', 'error')
    } finally {
      setGenerating(false)
    }
  }

  const handleUseTemplate = async (template) => {
    try {
      setCreatingFrom(template.id)
      const res = await adminAPI.createFromTemplate(template.id)
      showToast('Assignment created from template (draft)', 'success')
      onCreated(res.data.assignment)
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to use template', 'error')
    } finally {
      setCreatingFrom(null)
    }
  }

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const data = JSON.parse(await file.text())
      const res = await adminAPI.importAssignment(data)
      showToast('Assignment imported (draft)', 'success')
      onCreated(res.data.assignment)
    } catch (err) {
      showToast(err.response?.data?.error || 'Not a valid LTISim assignment file', 'error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 relative max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded hover:bg-gray-100 text-gray-400"
        >
          <X className="w-5 h-5" />
        </button>

        {mode === 'choose' && (
          <>
            <h2 className="text-xl font-bold text-surface-dark mb-1">Create new assignment</h2>
            <p className="text-sm text-gray-500 mb-5">Choose the type of activity students will work through.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { type: 'simulation', Icon: UserCircle, title: 'Simulation',
                  desc: 'Role-play with an AI persona — patient, client, customer, manager, etc. Best for clinical, counseling, sales, and customer-service practice.' },
                { type: 'llm_interaction', Icon: Sparkles, title: 'LLM Interaction',
                  desc: 'Open chat with a general AI assistant alongside instructor-authored learning content. Best for prompt engineering and discipline-specific tasks.' },
                { type: 'staged_simulation', Icon: Layers, title: 'Staged Simulation',
                  desc: 'A role-play that moves through ordered scenes — intake \u2192 exam \u2192 plan, discovery \u2192 objection \u2192 close. Criteria can be graded per stage.' },
                { type: 'ai_examiner', Icon: GraduationCap, title: 'AI Examiner',
                  desc: 'The AI leads: an oral exam or structured debrief that works through your question areas, probing follow-ups — without revealing answers.' },
                { type: 'simulation_with_artifact', Icon: FileText, title: 'Simulation + Write-up',
                  desc: 'Role-play followed by a written artifact (SOAP note, follow-up email, report) graded together with the conversation — including a consistency check.' },
              ].map(({ type, Icon, title, desc }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => onSelect(type)}
                  className="text-left p-4 border-2 border-gray-200 rounded-xl hover:border-primary-500 hover:shadow-md transition-all flex flex-col gap-2"
                >
                  <div className="w-9 h-9 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-semibold text-gray-800 text-sm">{title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
                </button>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setMode('describe')}
                className="p-3 border border-gray-200 rounded-lg hover:border-primary-400 hover:bg-primary-50/50 transition-colors text-left flex items-start gap-2"
              >
                <Wand2 className="w-4 h-4 text-primary-500 mt-0.5 flex-shrink-0" />
                <span>
                  <span className="block text-sm font-medium text-gray-700">Describe it</span>
                  <span className="block text-xs text-gray-400">AI drafts the whole assignment</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMode('templates')}
                className="p-3 border border-gray-200 rounded-lg hover:border-primary-400 hover:bg-primary-50/50 transition-colors text-left flex items-start gap-2"
              >
                <LayoutTemplate className="w-4 h-4 text-primary-500 mt-0.5 flex-shrink-0" />
                <span>
                  <span className="block text-sm font-medium text-gray-700">Start from template</span>
                  <span className="block text-xs text-gray-400">Curated, ready-to-adapt examples</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-3 border border-gray-200 rounded-lg hover:border-primary-400 hover:bg-primary-50/50 transition-colors text-left flex items-start gap-2"
              >
                <Upload className="w-4 h-4 text-primary-500 mt-0.5 flex-shrink-0" />
                <span>
                  <span className="block text-sm font-medium text-gray-700">Import file</span>
                  <span className="block text-xs text-gray-400">.ltisim.json export</span>
                </span>
              </button>
              <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportFile} />
            </div>
          </>
        )}

        {mode === 'describe' && (
          <>
            <button type="button" onClick={() => setMode('choose')} className="text-primary-500 text-sm font-medium inline-flex items-center gap-1 mb-3">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <h2 className="text-xl font-bold text-surface-dark mb-1">Describe your assignment</h2>
            <p className="text-sm text-gray-500 mb-4">
              A sentence or two is enough — who the students are, what they practice, what you want to assess.
              You'll get a complete editable draft: persona, scenario, and a full rubric.
            </p>
            <div className="flex gap-2 mb-3">
              {[['simulation', 'Simulation'], ['llm_interaction', 'LLM Interaction']].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDescribeType(value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    describeType === value ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows="5"
              autoFocus
              placeholder='e.g. "Nursing students practice a medication-reconciliation interview with an elderly patient who is confused about her prescriptions. Assess communication, information gathering, and empathy."'
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none resize-y text-sm"
            />
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || description.trim().length < 10}
              className="mt-3 px-5 py-2.5 bg-gradient-to-br from-primary-500 to-surface-dark text-white rounded-lg font-semibold shadow-md disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              <Wand2 className={`w-4 h-4 ${generating ? 'animate-pulse' : ''}`} />
              {generating ? 'Generating draft… (up to a minute)' : 'Generate draft'}
            </button>
            <p className="text-xs text-gray-400 mt-2">
              The draft opens in the editor for your review — nothing is saved or shown to students until you save it.
            </p>
          </>
        )}

        {mode === 'templates' && (
          <>
            <button type="button" onClick={() => setMode('choose')} className="text-primary-500 text-sm font-medium inline-flex items-center gap-1 mb-3">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <h2 className="text-xl font-bold text-surface-dark mb-1">Start from a template</h2>
            <p className="text-sm text-gray-500 mb-4">Creates a draft copy in your course that you can adapt freely.</p>
            {templates === null ? (
              <p className="text-sm text-gray-400 py-6 text-center">Loading templates…</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">No templates available yet.</p>
            ) : (
              <div className="space-y-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleUseTemplate(t)}
                    disabled={creatingFrom !== null}
                    className="w-full text-left p-4 border border-gray-200 rounded-lg hover:border-primary-400 hover:bg-primary-50/40 transition-colors disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800 text-sm">{t.title}</span>
                      {t.discipline && (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-xs">{t.discipline}</span>
                      )}
                      <span className="px-2 py-0.5 bg-primary-50 text-primary-600 rounded-full text-xs">
                        {t.assignment_type === 'llm_interaction' ? 'LLM Interaction' : 'Simulation'}
                      </span>
                      {creatingFrom === t.id && <span className="text-xs text-gray-400">Creating…</span>}
                    </div>
                    {t.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{t.description}</p>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default CreateAssignmentModal
