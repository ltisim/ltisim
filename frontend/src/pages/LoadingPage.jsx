import React from 'react'
import { MessageSquare } from 'lucide-react'

function LoadingPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <div className="relative">
        <div className="w-16 h-16 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <MessageSquare className="w-6 h-6 text-primary-500" />
        </div>
      </div>
      <p className="text-gray-500 animate-pulse-soft">Loading...</p>
    </div>
  )
}

export default LoadingPage
