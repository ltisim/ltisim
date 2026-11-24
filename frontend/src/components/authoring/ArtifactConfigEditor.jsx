import React from 'react'

// Config for the post-conversation write-up phase (simulation_with_artifact).
function ArtifactConfigEditor({ config, onChange }) {
  const c = config || {}
  const update = (field, value) => onChange({ ...c, [field]: value })

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-gray-500">
        After the conversation, students write this artifact (e.g. a SOAP note, follow-up email, or
        incident report). It's graded together with the transcript — the evaluator also flags artifact
        claims that aren't supported by the conversation. Scope individual criteria to the conversation
        or the artifact on the Rubric tab.
      </p>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-semibold text-gray-700">Artifact Title</label>
        <input
          type="text"
          value={c.title || ''}
          onChange={(e) => update('title', e.target.value)}
          placeholder='e.g. "Post-Encounter SOAP Note" or "Follow-up Email to the Client"'
          className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-semibold text-gray-700">Instructions</label>
        <span className="text-xs text-gray-400">Shown beside the writing area. Say what to include and how it will be judged.</span>
        <textarea
          value={c.instructions || ''}
          onChange={(e) => update('instructions', e.target.value)}
          rows="6"
          placeholder={'e.g. "Document the encounter in SOAP format. Include only findings actually established in your interview — the evaluation checks your note against the conversation."'}
          className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none resize-y text-sm"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-semibold text-gray-700">Template (optional)</label>
        <span className="text-xs text-gray-400">Pre-fills the writing area — e.g. a SOAP skeleton with section headings.</span>
        <textarea
          value={c.template_text || ''}
          onChange={(e) => update('template_text', e.target.value)}
          rows="6"
          placeholder={'Subjective:\n\nObjective:\n\nAssessment:\n\nPlan:'}
          className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none resize-y text-sm font-mono"
        />
      </div>

      <div className="flex gap-6">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-gray-700">Min words</span>
          <input
            type="number" min="1" max="5000"
            value={c.min_words ?? ''}
            onChange={(e) => update('min_words', e.target.value === '' ? null : parseInt(e.target.value) || null)}
            placeholder="none"
            className="w-28 px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-gray-700">Max words (guideline)</span>
          <input
            type="number" min="10" max="10000"
            value={c.max_words ?? ''}
            onChange={(e) => update('max_words', e.target.value === '' ? null : parseInt(e.target.value) || null)}
            placeholder="none"
            className="w-28 px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none"
          />
        </label>
      </div>
    </div>
  )
}

export default ArtifactConfigEditor
