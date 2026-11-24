import React from 'react'
import { Clock, CheckCircle2, Calendar, Trophy } from 'lucide-react'

function SessionInfo({ session, scoringEnabled }) {
  if (!session) return null

  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const isPendingReview = session.review_status === 'pending_review'

  const statusConfig = {
    in_progress: { label: 'In Progress', style: 'bg-primary-500 text-white', Icon: Clock },
    completed: isPendingReview
      ? { label: 'Awaiting Review', style: 'bg-blue-500 text-white', Icon: Clock }
      : { label: 'Completed', style: 'bg-success text-white', Icon: CheckCircle2 },
  }

  const status = statusConfig[session.status] || { label: session.status, style: '', Icon: Clock }
  const StatusIcon = status.Icon

  const showScore = scoringEnabled !== false && !isPendingReview

  return (
    <div className="bg-white px-5 py-3 rounded-lg shadow-sm flex flex-wrap gap-5">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-gray-500 text-sm">Status:</span>
        <span className={`px-3 py-0.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 ${status.style}`}>
          <StatusIcon className="w-3 h-3" />
          {status.label}
        </span>
        {session.is_practice && (
          <span
            className="px-3 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700"
            title="Practice sessions don't use an attempt and are never sent to the gradebook"
          >
            Practice — not graded
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-gray-400" />
        <span className="font-semibold text-gray-500 text-sm">Started:</span>
        <span className="text-gray-700 text-sm">{formatDate(session.started_at)}</span>
      </div>

      {session.completed_at && (
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="font-semibold text-gray-500 text-sm">Completed:</span>
          <span className="text-gray-700 text-sm">{formatDate(session.completed_at)}</span>
        </div>
      )}

      {showScore && session.score !== null && (
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-warning" />
          <span className="font-semibold text-gray-500 text-sm">Score:</span>
          <span className="font-bold text-success text-lg">{session.score}%</span>
        </div>
      )}
    </div>
  )
}

export default SessionInfo
