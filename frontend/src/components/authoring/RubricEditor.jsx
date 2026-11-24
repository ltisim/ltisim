import React, { useState } from 'react'
import { X, Trash2, ClipboardList, Plus, ChevronDown, ChevronRight, Sparkles, Link2 } from 'lucide-react'

const MAX_EXEMPLARS_PER_CRITERION = 5

// stages: pass the assignment's stages (staged_simulation) to offer per-
// criterion stage scoping. showAppliesTo: offer conversation/artifact/both
// scoping (simulation_with_artifact).
function RubricEditor({ rubric, onChange, scoringEnabled, onScoringEnabledChange, criteriaLabel = 'Criterion', stages = null, showAppliesTo = false, questionAreas = null }) {
  const [expandedExemplars, setExpandedExemplars] = useState({})

  const toggleExemplars = (criterionId) => {
    setExpandedExemplars((prev) => ({ ...prev, [criterionId]: !prev[criterionId] }))
  }
  const addCriterion = () => {
    const maxPts = scoringEnabled ? 10 : 0
    onChange([
      ...rubric,
      {
        id: `criterion_${Date.now()}`,
        name: '',
        description: '',
        max_points: maxPts,
        levels: scoringEnabled
          ? [
              { score: 10, label: 'Excellent', description: '' },
              { score: 7, label: 'Good', description: '' },
              { score: 4, label: 'Developing', description: '' },
              { score: 0, label: 'Not Met', description: '' },
            ]
          : [
              { score: 0, label: 'Excellent', description: '' },
              { score: 0, label: 'Good', description: '' },
              { score: 0, label: 'Developing', description: '' },
              { score: 0, label: 'Not Met', description: '' },
            ],
      },
    ])
  }

  const updateCriterion = (index, field, value) => {
    const updated = rubric.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    onChange(updated)
  }

  const removeCriterion = (index) => {
    onChange(rubric.filter((_, i) => i !== index))
  }

  const addLevel = (criterionIndex) => {
    const updated = rubric.map((c, i) => {
      if (i !== criterionIndex) return c
      return { ...c, levels: [...c.levels, { score: 0, label: '', description: '' }] }
    })
    onChange(updated)
  }

  const updateLevel = (criterionIndex, levelIndex, field, value) => {
    const updated = rubric.map((c, ci) => {
      if (ci !== criterionIndex) return c
      const levels = c.levels.map((l, li) =>
        li === levelIndex ? { ...l, [field]: value } : l
      )
      return { ...c, levels }
    })
    onChange(updated)
  }

  const removeLevel = (criterionIndex, levelIndex) => {
    const updated = rubric.map((c, ci) => {
      if (ci !== criterionIndex) return c
      return { ...c, levels: c.levels.filter((_, li) => li !== levelIndex) }
    })
    onChange(updated)
  }

  const addExemplar = (criterionIndex) => {
    const updated = rubric.map((c, ci) => {
      if (ci !== criterionIndex) return c
      const existing = Array.isArray(c.exemplars) ? c.exemplars : []
      if (existing.length >= MAX_EXEMPLARS_PER_CRITERION) return c
      const topLevel = c.levels && c.levels.length > 0 ? c.levels[0] : null
      return {
        ...c,
        exemplars: [
          ...existing,
          {
            id: `exemplar_${Date.now()}`,
            label: topLevel ? topLevel.label : '',
            score: scoringEnabled && topLevel ? topLevel.score : null,
            excerpt: '',
            explanation: '',
            source_session_id: null,
            created_at: new Date().toISOString(),
          },
        ],
      }
    })
    onChange(updated)
  }

  const updateExemplar = (criterionIndex, exemplarIndex, field, value) => {
    const updated = rubric.map((c, ci) => {
      if (ci !== criterionIndex) return c
      const exemplars = (c.exemplars || []).map((ex, ei) =>
        ei === exemplarIndex ? { ...ex, [field]: value } : ex
      )
      return { ...c, exemplars }
    })
    onChange(updated)
  }

  const removeExemplar = (criterionIndex, exemplarIndex) => {
    const updated = rubric.map((c, ci) => {
      if (ci !== criterionIndex) return c
      return { ...c, exemplars: (c.exemplars || []).filter((_, ei) => ei !== exemplarIndex) }
    })
    onChange(updated)
  }

  return (
    <div className="space-y-6">
      {/* Scoring mode toggle */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <div className="relative">
            <input
              type="checkbox"
              checked={scoringEnabled}
              onChange={(e) => onScoringEnabledChange(e.target.checked)}
              className="sr-only"
            />
            <div className={`w-11 h-6 rounded-full transition-colors ${scoringEnabled ? 'bg-primary-500' : 'bg-gray-300'}`} />
            <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${scoringEnabled ? 'translate-x-5' : ''}`} />
          </div>
          <div>
            <span className="text-sm font-semibold text-gray-700">
              {scoringEnabled ? 'Scored Mode' : 'Scoreless Mode (Completion Credit)'}
            </span>
            <p className="text-xs text-gray-400 mt-0.5">
              {scoringEnabled
                ? 'AI evaluates with numeric scores. Students receive a calculated grade.'
                : 'AI evaluates qualitatively only. Students receive 100% completion credit.'}
            </p>
          </div>
        </label>
      </div>

      {rubric.map((criterion, ci) => (
        <div key={criterion.id} className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-gray-500 flex items-center gap-1.5">
                <ClipboardList className="w-4 h-4 text-primary-500" />
                {criteriaLabel} {ci + 1}
              </span>
              <button
                type="button"
                onClick={() => removeCriterion(ci)}
                className="px-2 py-1 text-xs bg-red-100 text-red-600 rounded hover:bg-red-200 inline-flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                Remove
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder={`${criteriaLabel} name`}
                  value={criterion.name}
                  onChange={(e) => updateCriterion(ci, 'name', e.target.value)}
                  className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none"
                />
                {scoringEnabled && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-gray-600 whitespace-nowrap">Max pts:</span>
                    <input
                      type="number"
                      min="0"
                      value={criterion.max_points}
                      onChange={(e) => updateCriterion(ci, 'max_points', parseInt(e.target.value) || 0)}
                      className="w-20 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm focus:border-primary-500 focus:outline-none"
                    />
                  </label>
                )}
              </div>
              <textarea
                placeholder={`${criteriaLabel} description`}
                value={criterion.description}
                onChange={(e) => updateCriterion(ci, 'description', e.target.value)}
                rows="2"
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none resize-y"
              />
              {Array.isArray(stages) && stages.length > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-gray-600 whitespace-nowrap">Graded on:</span>
                  <select
                    value={criterion.stage_id || ''}
                    onChange={(e) => updateCriterion(ci, 'stage_id', e.target.value || undefined)}
                    className="px-2 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-primary-500 focus:outline-none bg-white"
                  >
                    <option value="">Whole conversation (all stages)</option>
                    {stages.map((st, i) => (
                      <option key={st.id} value={st.id}>Stage {i + 1}: {st.title}</option>
                    ))}
                  </select>
                </label>
              )}
              {Array.isArray(questionAreas) && questionAreas.length > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-gray-600 whitespace-nowrap">Graded on:</span>
                  <select
                    value={criterion.question_area_id || ''}
                    onChange={(e) => updateCriterion(ci, 'question_area_id', e.target.value || undefined)}
                    className="px-2 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-primary-500 focus:outline-none bg-white"
                  >
                    <option value="">Whole conversation (all areas)</option>
                    {questionAreas.map((a, i) => (
                      <option key={a.id} value={a.id}>Area {i + 1}: {a.topic || a.id}</option>
                    ))}
                  </select>
                </label>
              )}
              {showAppliesTo && (
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-gray-600 whitespace-nowrap">Graded on:</span>
                  <select
                    value={criterion.applies_to || 'both'}
                    onChange={(e) => updateCriterion(ci, 'applies_to', e.target.value)}
                    className="px-2 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-primary-500 focus:outline-none bg-white"
                  >
                    <option value="both">Conversation + written artifact</option>
                    <option value="conversation">Conversation only</option>
                    <option value="artifact">Written artifact only</option>
                  </select>
                </label>
              )}
            </div>
          </div>

          <div className="p-4 space-y-2">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {scoringEnabled ? 'Score Levels' : 'Proficiency Levels'}
            </span>
            {criterion.levels.map((level, li) => (
              <div key={li} className="flex gap-2 items-center">
                {scoringEnabled && (
                  <input
                    type="number"
                    min="0"
                    value={level.score}
                    onChange={(e) => updateLevel(ci, li, 'score', parseInt(e.target.value) || 0)}
                    className="w-16 px-2 py-1.5 border border-gray-200 rounded text-sm text-center focus:border-primary-500 focus:outline-none"
                    placeholder="Pts"
                  />
                )}
                <input
                  type="text"
                  value={level.label}
                  onChange={(e) => updateLevel(ci, li, 'label', e.target.value)}
                  className="w-28 px-2 py-1.5 border border-gray-200 rounded text-sm focus:border-primary-500 focus:outline-none"
                  placeholder="Label"
                />
                <input
                  type="text"
                  value={level.description}
                  onChange={(e) => updateLevel(ci, li, 'description', e.target.value)}
                  className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-sm focus:border-primary-500 focus:outline-none"
                  placeholder="Description"
                />
                <button
                  type="button"
                  onClick={() => removeLevel(ci, li)}
                  className="text-red-400 hover:text-red-600 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addLevel(ci)}
              className="text-xs text-primary-500 hover:text-primary-700 font-medium inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Level
            </button>
          </div>

          {/* Few-shot exemplars (optional) */}
          <div className="border-t border-gray-200 bg-gray-50/50">
            <button
              type="button"
              onClick={() => toggleExemplars(criterion.id)}
              className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-100 transition-colors"
            >
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {expandedExemplars[criterion.id] ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                <Sparkles className="w-3.5 h-3.5 text-primary-500" />
                Exemplars ({(criterion.exemplars || []).length})
                <span className="text-[10px] font-normal normal-case text-gray-400 ml-1">optional few-shot calibration</span>
              </span>
            </button>

            {expandedExemplars[criterion.id] && (
              <div className="p-4 pt-0 space-y-3">
                <p className="text-xs text-gray-500 italic">
                  1–3 high-quality exemplars per {criteriaLabel.toLowerCase()} typically give the biggest lift to AI grading accuracy. Leave empty to grade using level descriptions alone.
                </p>

                {(criterion.exemplars || []).map((exemplar, ei) => (
                  <div key={exemplar.id || ei} className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-500">Example {String.fromCharCode(65 + ei)}</span>
                      {exemplar.source_session_id && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-primary-50 text-primary-600 rounded-full">
                          <Link2 className="w-3 h-3" />
                          From session #{exemplar.source_session_id}
                        </span>
                      )}
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={() => removeExemplar(ci, ei)}
                        className="text-red-400 hover:text-red-600 p-1"
                        aria-label="Remove exemplar"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={exemplar.label || ''}
                        onChange={(e) => updateExemplar(ci, ei, 'label', e.target.value)}
                        placeholder="Label (e.g. Exemplary)"
                        className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-sm focus:border-primary-500 focus:outline-none"
                      />
                      {scoringEnabled && (
                        <label className="flex items-center gap-1 text-xs text-gray-600">
                          <span className="whitespace-nowrap">Score:</span>
                          <input
                            type="number"
                            min="0"
                            value={exemplar.score == null ? '' : exemplar.score}
                            onChange={(e) => updateExemplar(ci, ei, 'score', e.target.value === '' ? null : parseInt(e.target.value) || 0)}
                            className="w-16 px-2 py-1.5 border border-gray-200 rounded text-sm text-center focus:border-primary-500 focus:outline-none"
                            placeholder="Pts"
                          />
                        </label>
                      )}
                    </div>

                    <textarea
                      value={exemplar.excerpt || ''}
                      onChange={(e) => updateExemplar(ci, ei, 'excerpt', e.target.value.slice(0, 5000))}
                      placeholder="Paste or type an example student response (transcript excerpt or final artifact)…"
                      rows="6"
                      className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-mono focus:border-primary-500 focus:outline-none resize-y"
                    />
                    <div className="text-[10px] text-gray-400 text-right">{(exemplar.excerpt || '').length} / 5000</div>

                    <textarea
                      value={exemplar.explanation || ''}
                      onChange={(e) => updateExemplar(ci, ei, 'explanation', e.target.value.slice(0, 2000))}
                      placeholder="Why does this score here? What should graders look for?"
                      rows="3"
                      className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:border-primary-500 focus:outline-none resize-y"
                    />
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => addExemplar(ci)}
                  disabled={(criterion.exemplars || []).length >= MAX_EXEMPLARS_PER_CRITERION}
                  className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-primary-500 hover:text-primary-500 transition-colors text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-gray-300 disabled:hover:text-gray-500"
                >
                  <Plus className="w-4 h-4" />
                  {(criterion.exemplars || []).length >= MAX_EXEMPLARS_PER_CRITERION
                    ? `Maximum ${MAX_EXEMPLARS_PER_CRITERION} exemplars reached`
                    : 'Add Exemplar'}
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addCriterion}
        className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-primary-500 hover:text-primary-500 transition-colors text-sm font-medium flex items-center justify-center gap-1.5"
      >
        <Plus className="w-4 h-4" />
        Add {criteriaLabel === 'Task' ? 'Task' : 'Rubric Criterion'}
      </button>
    </div>
  )
}

export default RubricEditor
