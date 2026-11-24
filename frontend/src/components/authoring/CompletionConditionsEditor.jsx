import React from 'react'
import { MessageSquareMore, Zap } from 'lucide-react'

function CompletionConditionsEditor({ conditions, onChange }) {
  const update = (field, value) => {
    onChange({ ...conditions, [field]: value })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <MessageSquareMore className="w-4 h-4 text-primary-500" />
            Minimum Messages
          </label>
          <input
            type="number"
            min="0"
            value={conditions.min_messages || ''}
            onChange={(e) => update('min_messages', parseInt(e.target.value) || 0)}
            placeholder="No minimum"
            className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none"
          />
          <span className="text-xs text-gray-400">Student must send at least this many messages before completing</span>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <MessageSquareMore className="w-4 h-4 text-primary-500" />
            Maximum Messages
          </label>
          <input
            type="number"
            min="0"
            value={conditions.max_messages || ''}
            onChange={(e) => update('max_messages', parseInt(e.target.value) || 0)}
            placeholder="No maximum"
            className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none"
          />
          <span className="text-xs text-gray-400">Session ends after this many messages</span>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={conditions.auto_complete || false}
          onChange={(e) => update('auto_complete', e.target.checked)}
          className="w-4 h-4"
        />
        <Zap className="w-4 h-4 text-primary-500" />
        <span className="text-gray-700">Auto-complete when max messages reached</span>
      </label>
    </div>
  )
}

export default CompletionConditionsEditor
