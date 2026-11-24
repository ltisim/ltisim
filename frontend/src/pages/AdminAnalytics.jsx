import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { adminAPI } from '../utils/api'
import { useToast } from '../components/Toast'
import AdminNav from '../components/AdminNav'
import { downloadResultsCsv } from '../utils/download'
import { ArrowLeft, Users, CheckSquare, BarChart3, MessageSquare, Download, BookOpen } from 'lucide-react'

// Class-level analytics for one assignment, aggregated over each student's
// latest completed attempt (route: /admin/assignments/:assignmentId/analytics).
function AdminAnalytics({ user }) {
  const navigate = useNavigate()
  const { assignmentId } = useParams()
  const { showToast } = useToast()
  const [assignment, setAssignment] = useState(null)
  const [course, setCourse] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [hoverBucket, setHoverBucket] = useState(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const [assignmentsRes, analyticsRes, courseRes] = await Promise.all([
          adminAPI.getAssignments(),
          adminAPI.getAnalytics(assignmentId),
          adminAPI.getCourse(),
        ])
        const found = assignmentsRes.data.assignments.find((a) => String(a.id) === String(assignmentId))
        if (!found) {
          setError('Assignment not found.')
          return
        }
        setAssignment(found)
        setData(analyticsRes.data)
        setCourse(courseRes.data.course)
        setError(null)
      } catch (err) {
        console.error('Error loading analytics:', err)
        setError('Failed to load analytics. Please try again.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [assignmentId])

  const handleExport = async () => {
    try {
      setExporting(true)
      await downloadResultsCsv(assignment.id, assignment.title)
    } catch (err) {
      console.error('Error exporting CSV:', err)
      showToast('Failed to export results', 'error')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-100 items-center justify-center">
        <div className="loading-spinner" />
        <p className="mt-4 text-gray-500">Loading analytics...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-100 items-center justify-center p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg px-6 py-4 text-red-700 text-center">{error}</div>
      </div>
    )
  }

  const { summary, criteria, distribution, scoring_enabled: scoringEnabled, max_score: maxScore } = data

  // 10 fixed buckets; backend omits empty ones
  const bucketCounts = Array.from({ length: 10 }, (_, i) => {
    const row = distribution.find((d) => Number(d.bucket) === i + 1)
    return row ? Number(row.count) : 0
  })
  const maxBucket = Math.max(...bucketCounts, 1)
  const bucketLabel = (i) => (i === 9 ? '90–100' : `${i * 10}–${i * 10 + 9}`)

  // Sequential single-hue ramp across ordered proficiency levels (best first).
  // Ordinal scale, one hue, light→dark — CVD-safe by construction.
  const RAMP = [
    { bg: 'bg-primary-600', text: 'text-white' },
    { bg: 'bg-primary-500', text: 'text-white' },
    { bg: 'bg-primary-300', text: 'text-gray-800' },
    { bg: 'bg-primary-200', text: 'text-gray-800' },
    { bg: 'bg-primary-100', text: 'text-gray-700' },
    { bg: 'bg-gray-200', text: 'text-gray-700' },
  ]
  const rampFor = (idx, total) => {
    if (idx < 0) return RAMP[RAMP.length - 1] // level label not in current rubric
    if (total <= 1) return RAMP[0]
    const pos = Math.round((idx / (total - 1)) * (RAMP.length - 2))
    return RAMP[Math.min(pos, RAMP.length - 2)]
  }

  const noData = !summary.students_completed

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      <AdminNav course={course} user={user} />

      <div className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-5">
        <div className="space-y-3">
          <button
            className="text-primary-500 font-semibold text-sm hover:text-surface-dark transition-colors inline-flex items-center gap-1"
            onClick={() => navigate(`/admin/assignments/${assignmentId}/sessions`)}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Sessions
          </button>
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div>
              <h3 className="text-2xl font-bold text-surface-dark">{assignment.title} - Analytics</h3>
              <p className="text-xs text-gray-500 mt-1">
                Aggregated over each student's latest completed attempt. Includes unreleased drafts (visible to instructors only).
              </p>
            </div>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Students completed', value: summary.students_completed ?? 0, Icon: Users },
            { label: 'In progress', value: summary.in_progress ?? 0, Icon: BookOpen },
            ...(scoringEnabled ? [{
              label: 'Avg score (latest attempt)',
              value: summary.avg_score != null ? `${summary.avg_score}/${maxScore}` : '—',
              sub: summary.min_score != null ? `min ${summary.min_score} · max ${summary.max_score}` : null,
              Icon: BarChart3,
            }] : []),
            { label: 'Avg student messages', value: summary.avg_student_messages ?? '—', Icon: MessageSquare },
            { label: 'Total sessions (all attempts)', value: summary.total_sessions ?? 0, Icon: CheckSquare },
          ].map((tile) => (
            <div key={tile.label} className="bg-white rounded-lg p-4 shadow-sm">
              <div className="flex items-center gap-1.5 text-gray-400 text-xs font-semibold uppercase tracking-wide mb-1.5">
                <tile.Icon className="w-3.5 h-3.5" />
                {tile.label}
              </div>
              <div className="text-2xl font-bold text-surface-dark">{tile.value}</div>
              {tile.sub && <div className="text-xs text-gray-400 mt-0.5">{tile.sub}</div>}
            </div>
          ))}
        </div>

        {noData ? (
          <div className="bg-white rounded-lg shadow-sm py-16 text-center">
            <BarChart3 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No completed sessions yet</p>
            <p className="text-gray-400 text-sm mt-1">Analytics appear once students complete the assignment.</p>
          </div>
        ) : (
          <>
            {/* Score distribution */}
            {scoringEnabled && (
              <div className="bg-white rounded-lg p-5 shadow-sm">
                <h4 className="text-sm font-bold text-surface-dark mb-1">Score Distribution</h4>
                <p className="text-xs text-gray-400 mb-4">Latest completed attempt per student, as % of max score.</p>
                <div className="flex items-end gap-1.5 h-36">
                  {bucketCounts.map((count, i) => (
                    <div
                      key={i}
                      className="flex-1 flex flex-col items-center justify-end relative h-full"
                      onMouseEnter={() => setHoverBucket(i)}
                      onMouseLeave={() => setHoverBucket(null)}
                    >
                      {hoverBucket === i && (
                        <div className="absolute -top-7 bg-surface-darker text-white text-xs px-2 py-0.5 rounded whitespace-nowrap pointer-events-none z-10">
                          {bucketLabel(i)}%: {count} student{count === 1 ? '' : 's'}
                        </div>
                      )}
                      <div
                        className={`w-full rounded-t transition-colors ${hoverBucket === i ? 'bg-primary-400' : 'bg-primary-500'} ${count === 0 ? 'opacity-0' : ''}`}
                        style={{ height: `${(count / maxBucket) * 100}%`, minHeight: count > 0 ? '4px' : 0 }}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5 mt-1.5">
                  {bucketCounts.map((_, i) => (
                    <div key={i} className="flex-1 text-center text-[10px] text-gray-400">{bucketLabel(i)}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Criterion-level distribution */}
            <div className="bg-white rounded-lg p-5 shadow-sm">
              <h4 className="text-sm font-bold text-surface-dark mb-1">Performance by Criterion</h4>
              <p className="text-xs text-gray-400 mb-4">
                Share of students at each proficiency level (latest attempt). Darker = higher level.
              </p>
              <div className="space-y-4">
                {criteria.map((c) => {
                  const total = c.levels.reduce((acc, lv) => acc + lv.count, 0)
                  const labelOrder = c.level_labels || []
                  const ordered = [...c.levels].sort((a, b) => {
                    const ia = labelOrder.findIndex((l) => l.toLowerCase() === a.level.toLowerCase())
                    const ib = labelOrder.findIndex((l) => l.toLowerCase() === b.level.toLowerCase())
                    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
                  })
                  return (
                    <div key={c.criterion_id}>
                      <div className="flex justify-between items-baseline text-sm mb-1.5">
                        <span className="font-semibold text-gray-800">{c.name}</span>
                        <span className="text-xs text-gray-500">
                          {scoringEnabled && c.avg_score != null && c.max_points != null && (
                            <>avg {c.avg_score}/{c.max_points} · </>
                          )}
                          {total} student{total === 1 ? '' : 's'}
                        </span>
                      </div>
                      {total === 0 ? (
                        <div className="h-7 rounded bg-gray-50 border border-dashed border-gray-200 flex items-center px-3 text-xs text-gray-400">
                          No graded sessions yet
                        </div>
                      ) : (
                        <div className="flex h-7 rounded overflow-hidden gap-0.5">
                          {ordered.map((lv) => {
                            const idx = labelOrder.findIndex((l) => l.toLowerCase() === lv.level.toLowerCase())
                            const ramp = rampFor(idx, labelOrder.length)
                            const pctNum = (lv.count / total) * 100
                            return (
                              <div
                                key={lv.level}
                                className={`${ramp.bg} ${ramp.text} flex items-center justify-center text-[11px] font-medium overflow-hidden whitespace-nowrap`}
                                style={{ width: `${pctNum}%`, minWidth: '3px' }}
                                title={`${lv.level}: ${lv.count} student${lv.count === 1 ? '' : 's'} (${pctNum.toFixed(0)}%)`}
                              >
                                {pctNum >= 14 && `${lv.level} · ${lv.count}`}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {/* Level legend from the first criterion with labels (labels can differ per criterion; hover any segment for exact values) */}
              {criteria.some((c) => (c.level_labels || []).length > 0) && (
                <div className="flex items-center gap-3 mt-4 pt-3 border-t border-gray-100 flex-wrap">
                  {(criteria.find((c) => (c.level_labels || []).length > 0)?.level_labels || []).map((label, idx, arr) => {
                    const ramp = rampFor(idx, arr.length)
                    return (
                      <span key={label} className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                        <span className={`w-3 h-3 rounded-sm ${ramp.bg}`} />
                        {label}
                      </span>
                    )
                  })}
                  <span className="text-[11px] text-gray-400">(levels are per-criterion; hover a segment for exact counts)</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default AdminAnalytics
