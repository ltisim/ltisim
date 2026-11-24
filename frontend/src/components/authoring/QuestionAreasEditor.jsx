import React from 'react'
import { Plus, Trash2, ArrowUp, ArrowDown, HelpCircle } from 'lucide-react'

// Question areas for ai_examiner: the AI works through these in order,
// probing follow-ups per area. Guidance is examiner-side (students never see
// it); rubric criteria can be scoped to an area on the Rubric tab.
function QuestionAreasEditor({ config, onChange }) {
  const cfg = config || { style: 'exam', question_areas: [] }
  const areas = cfg.question_areas || []

  const setStyle = (style) => onChange({ ...cfg, style })
  const setAreas = (question_areas) => onChange({ ...cfg, question_areas })

  const update = (i, field, value) => {
    const copy = areas.map((a) => ({ ...a }))
    copy[i][field] = value
    setAreas(copy)
  }

  const add = () => {
    if (areas.length >= 10) return
    setAreas([...areas, { id: `area${Date.now()}`, topic: '', guidance: '', required: true, followup_depth: 1 }])
  }

  const remove = (i) => setAreas(areas.filter((_, idx) => idx !== i))
  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= areas.length) return
    const copy = [...areas]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    setAreas(copy)
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Conversation style</h3>
        <div className="flex gap-2">
          {[['exam', 'Oral exam', 'Neutral examiner: probes understanding, never reveals or confirms answers.'],
            ['debrief', 'Structured debrief', 'Reflective coach: draws out the student\'s own thinking and lessons learned.']].map(([value, label, desc]) => (
            <label key={value} className={`flex-1 p-3 border-2 rounded-lg cursor-pointer transition-colors ${
              cfg.style === value ? 'border-primary-500 bg-primary-50/40' : 'border-gray-200 hover:bg-gray-50'
            }`}>
              <input type="radio" className="sr-only" checked={cfg.style === value} onChange={() => setStyle(value)} />
              <span className="block text-sm font-medium text-gray-700">{label}</span>
              <span className="block text-xs text-gray-400 mt-0.5">{desc}</span>
            </label>
          ))}
        </div>
      </div>

      <p className="text-sm text-gray-500">
        The AI asks one question at a time and works through these areas in order, probing follow-ups
        based on answer quality. Students see the topic list and their progress — never your guidance.
        Set the opening question as the Welcome Message on the Basics tab.
      </p>

      {areas.map((area, i) => (
        <div key={area.id} className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-500 flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 text-primary-500" />
              Area {i + 1}
            </span>
            <span className="flex items-center gap-1">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === areas.length - 1}
                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => remove(i)}
                className="ml-1 px-2 py-1 text-xs bg-red-100 text-red-600 rounded hover:bg-red-200 inline-flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Remove
              </button>
            </span>
          </div>
          <div className="p-4 space-y-3">
            <input
              type="text"
              placeholder='Topic (students see this, e.g. "Interpreting the blood gas results")'
              value={area.topic}
              onChange={(e) => update(i, 'topic', e.target.value)}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none"
            />
            <textarea
              placeholder="Guidance for the examiner (students never see this): what to ask about, what a strong answer includes, common misconceptions to probe."
              value={area.guidance}
              onChange={(e) => update(i, 'guidance', e.target.value)}
              rows="3"
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none resize-y text-sm"
            />
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={area.required !== false}
                  onChange={(e) => update(i, 'required', e.target.checked)}
                />
                Required before completion
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                Follow-up depth:
                <select
                  value={area.followup_depth ?? 1}
                  onChange={(e) => update(i, 'followup_depth', Number(e.target.value))}
                  className="px-2 py-1 border-2 border-gray-200 rounded-lg text-sm focus:border-primary-500 focus:outline-none bg-white"
                >
                  <option value={0}>0 — move on after the answer</option>
                  <option value={1}>1 follow-up</option>
                  <option value={2}>2 follow-ups</option>
                </select>
              </label>
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        disabled={areas.length >= 10}
        className="px-4 py-2 bg-primary-100 text-primary-700 rounded-lg text-sm font-medium hover:bg-primary-200 disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        <Plus className="w-4 h-4" />
        Add Question Area {areas.length >= 10 && '(max 10)'}
      </button>
    </div>
  )
}

export default QuestionAreasEditor
