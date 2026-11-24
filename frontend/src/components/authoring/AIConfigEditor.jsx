import React, { useEffect, useState } from 'react'
import { Cpu, Scale, Thermometer, Hash, AlertTriangle } from 'lucide-react'
import { adminAPI } from '../../utils/api'

// Per-assignment AI settings. The provider, the selectable models and the
// defaults are instance settings served by the backend
// (GET /api/admin/ai-models); nothing here is hardcoded.
function AIConfigEditor({ config, onChange }) {
  const [catalog, setCatalog] = useState(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    adminAPI.getAiModels()
      .then((res) => { if (!cancelled) setCatalog(res.data) })
      .catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [])

  const update = (field, value) => {
    onChange({ ...config, [field]: value })
  }

  const models = catalog?.models || []
  const nameOf = (id) => models.find((m) => m.id === id)?.name || id
  // Keep a previously saved model visible even if the instance no longer
  // offers it, so opening the editor never silently changes the setting.
  const optionsFor = (selected) =>
    selected && catalog && !models.some((m) => m.id === selected)
      ? [{ id: selected, name: `${selected} (no longer available)` }, ...models]
      : models
  const defaultLabel = (id, fallback) => (id ? `Installation default (${nameOf(id)})` : fallback)
  const selectClass = 'px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none bg-white disabled:bg-gray-50'
  // No default and nothing chosen here: this assignment cannot run.
  const notConfigured = catalog && !catalog.default_model && !config.model
  const maxTokens = config.max_tokens || 2048

  return (
    <div className="space-y-5">
      {loadError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
          Could not load the list of models. Your saved settings are unchanged; reload the page to try again.
        </p>
      )}
      {notConfigured && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            No default model has been set for this installation yet, so this assignment cannot run.
            {models.length > 0
              ? ' Choose a conversation model below, or ask your administrator to set a default.'
              : ' Ask your administrator to add models in the Instance settings.'}
          </span>
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="ai-model" className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-primary-500" />
            Conversation model
          </label>
          <select
            id="ai-model"
            value={config.model || ''}
            onChange={(e) => update('model', e.target.value)}
            disabled={!catalog}
            className={selectClass}
          >
            <option value="">{defaultLabel(catalog?.default_model, 'Installation default (not set)')}</option>
            {optionsFor(config.model).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <span className="text-xs text-gray-500">Plays the role in the conversation with the student.</span>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="ai-grading-model" className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <Scale className="w-4 h-4 text-primary-500" />
            Grading model
          </label>
          <select
            id="ai-grading-model"
            value={config.grading_model || ''}
            onChange={(e) => update('grading_model', e.target.value)}
            disabled={!catalog}
            className={selectClass}
          >
            <option value="">
              {defaultLabel(catalog?.default_grading_model, 'Installation default')} — recommended
            </option>
            {optionsFor(config.grading_model).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <span className="text-xs text-gray-500">
            Scores the session against your rubric. Keep the default unless you have compared models on your own
            rubric: a weaker grader gives less reliable scores.
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="ai-temperature" className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          <Thermometer className="w-4 h-4 text-primary-500" />
          Variation in replies: {config.temperature ?? 0.7}
        </label>
        <input
          id="ai-temperature"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={config.temperature ?? 0.7}
          onChange={(e) => update('temperature', parseFloat(e.target.value))}
          className="w-full accent-primary-500"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>Consistent (0)</span>
          <span>Varied (1)</span>
        </div>
        <span className="text-xs text-gray-500">
          Applies to the conversation only; grading always uses a low, fixed setting. Some models ignore this.
        </span>
      </div>

      <div className="flex flex-col gap-1 max-w-xs">
        <label htmlFor="ai-max-tokens" className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          <Hash className="w-4 h-4 text-primary-500" />
          Longest reply (tokens)
        </label>
        <input
          id="ai-max-tokens"
          type="number"
          min="100"
          max="8192"
          value={maxTokens}
          onChange={(e) => update('max_tokens', parseInt(e.target.value) || 2048)}
          className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none"
        />
        <span className="text-xs text-gray-500">
          About {Math.round((maxTokens * 0.75) / 50) * 50} words. Replies are cut off at this length (100–8192).
        </span>
      </div>

      {catalog && (
        <p className="text-xs text-gray-400">
          Models are provided through {catalog.provider_name}, chosen by your administrator for the whole installation.
        </p>
      )}
    </div>
  )
}

export default AIConfigEditor
