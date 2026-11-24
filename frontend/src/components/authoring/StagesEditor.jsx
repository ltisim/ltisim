import React from 'react'
import { Plus, Trash2, ArrowUp, ArrowDown, Layers } from 'lucide-react'

// Stage list for staged_simulation: ordered scenes, each with its own scene
// context (written from the persona's perspective), an optional persona-name
// override, and the student-message minimum before advancing.
function StagesEditor({ stages, onChange }) {
  const list = Array.isArray(stages) ? stages : []

  const update = (i, field, value) => {
    const copy = list.map((s) => ({ ...s }))
    copy[i][field] = value
    onChange(copy)
  }

  const add = () => {
    if (list.length >= 8) return
    onChange([
      ...list,
      { id: `stage${Date.now()}`, title: `Stage ${list.length + 1}`, scene_context: '', persona_name: '', min_messages: 2 },
    ])
  }

  const remove = (i) => onChange(list.filter((_, idx) => idx !== i))

  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const copy = [...list]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    onChange(copy)
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-gray-500">
        The conversation moves through these stages in order. Students advance with a "Continue to next
        stage" button once they've sent the stage's minimum messages; the scene shift is visible in the
        chat and the AI plays the new scene. Rubric criteria can be scoped to a single stage on the
        Rubric tab.
      </p>

      {list.map((stage, i) => (
        <div key={stage.id} className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-500 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-primary-500" />
              Stage {i + 1}{i === list.length - 1 && list.length > 1 ? ' (final)' : ''}
            </span>
            <span className="flex items-center gap-1">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1}
                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => remove(i)}
                className="ml-1 px-2 py-1 text-xs bg-red-100 text-red-600 rounded hover:bg-red-200 inline-flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Remove
              </button>
            </span>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Stage title (students see this, e.g. 'The family meeting')"
                value={stage.title}
                onChange={(e) => update(i, 'title', e.target.value)}
                className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none"
              />
              <label className="flex items-center gap-2 text-sm">
                <span className="text-gray-600 whitespace-nowrap">Min msgs:</span>
                <input
                  type="number" min="1" max="25"
                  value={stage.min_messages || 1}
                  onChange={(e) => update(i, 'min_messages', parseInt(e.target.value) || 1)}
                  className="w-16 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm focus:border-primary-500 focus:outline-none"
                />
              </label>
            </div>
            <textarea
              placeholder="Scene context for this stage — written from the persona's perspective (what just happened, where the scene is now, their state of mind). Students don't see this."
              value={stage.scene_context}
              onChange={(e) => update(i, 'scene_context', e.target.value)}
              rows="4"
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none resize-y text-sm"
            />
            <input
              type="text"
              placeholder="Persona name override for this stage (optional — e.g. a family member enters)"
              value={stage.persona_name || ''}
              onChange={(e) => update(i, 'persona_name', e.target.value)}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none text-sm"
            />
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        disabled={list.length >= 8}
        className="px-4 py-2 bg-primary-100 text-primary-700 rounded-lg text-sm font-medium hover:bg-primary-200 disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        <Plus className="w-4 h-4" />
        Add Stage {list.length >= 8 && '(max 8)'}
      </button>
    </div>
  )
}

export default StagesEditor
