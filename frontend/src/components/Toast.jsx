import React, { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

const typeStyles = {
  success: 'bg-green-600',
  error: 'bg-red-600',
  warning: 'bg-amber-500',
  info: 'bg-blue-600',
}

const typeIcons = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const showToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5000)
  }, [])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => {
          const Icon = typeIcons[toast.type] || typeIcons.info
          return (
            <div
              key={toast.id}
              className={`${typeStyles[toast.type] || typeStyles.info} text-white px-5 py-3 rounded-lg shadow-lg animate-slide-in flex items-center gap-3 max-w-sm`}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              <span className="flex-1 text-sm">{toast.message}</span>
              <button
                onClick={() => removeToast(toast.id)}
                className="text-white/80 hover:text-white leading-none"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
