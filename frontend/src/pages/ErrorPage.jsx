import React from 'react'
import { AlertOctagon } from 'lucide-react'

function ErrorPage({ message }) {
  return (
    <div className="flex items-center justify-center min-h-screen p-8">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md text-center">
        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
          <AlertOctagon className="w-8 h-8 text-danger" />
        </div>
        <h1 className="text-danger text-2xl font-bold mb-4">Error</h1>
        <p className="text-gray-700">{message || 'An unexpected error occurred.'}</p>
        <p className="mt-4 text-sm text-gray-500">
          If you continue to experience issues, please contact your instructor.
        </p>
      </div>
    </div>
  )
}

export default ErrorPage
