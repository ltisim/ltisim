import React from 'react'
import { AlertTriangle, HelpCircle, X } from 'lucide-react'

function ConfirmModal({ isOpen, title, message, onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel', confirmDanger = false }) {
  if (!isOpen) return null

  const Icon = confirmDanger ? AlertTriangle : HelpCircle

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-md w-[90%] animate-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 border-b border-gray-200 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
            confirmDanger ? 'bg-red-100' : 'bg-blue-100'
          }`}>
            <Icon className={`w-5 h-5 ${confirmDanger ? 'text-red-600' : 'text-blue-600'}`} />
          </div>
          <h3 className="text-xl font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="px-6 py-6">
          <p className="text-gray-600 leading-relaxed">{message}</p>
        </div>
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-xl flex justify-end gap-3">
          <button
            className="px-5 py-2.5 bg-gray-100 text-gray-500 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            className={`px-5 py-2.5 text-white rounded-lg font-medium shadow-md hover:-translate-y-0.5 hover:shadow-lg transition-all ${
              confirmDanger
                ? 'bg-gradient-to-br from-red-600 to-red-900'
                : 'bg-gradient-to-br from-primary-500 to-surface-dark'
            }`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmModal
