import React, { useState, useEffect } from 'react'
import { adminAPI } from '../utils/api'
import { BookOpen, Loader2, AlertCircle, Check, Plus, Globe } from 'lucide-react'

// Same-origin: the backend serves this bundle, so no URL is baked in at build time.
const API_BASE_URL = ''

function DeepLinkPicker({ ltik }) {
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [publishingId, setPublishingId] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)

  useEffect(() => {
    loadAssignments()
  }, [])

  const loadAssignments = async () => {
    try {
      const response = await adminAPI.getAssignments()
      setAssignments(response.data.assignments)
    } catch (err) {
      console.error('Error loading assignments:', err)
      setError('Failed to load assignments. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (assignmentId) => {
    setSelectedId(assignmentId)
    window.location.href = `${API_BASE_URL}/api/admin/deep-link/complete?assignmentId=${assignmentId}&ltik=${ltik}`
  }

  const handlePublishAndLink = async (assignmentId) => {
    setPublishingId(assignmentId)
    try {
      await adminAPI.updateAssignment(assignmentId, { is_published: true })
      setSelectedId(assignmentId)
      window.location.href = `${API_BASE_URL}/api/admin/deep-link/complete?assignmentId=${assignmentId}&ltik=${ltik}`
    } catch (err) {
      console.error('Error publishing assignment:', err)
      setPublishingId(null)
    }
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return

    setCreating(true)
    setCreateError(null)
    try {
      const response = await adminAPI.createAssignment({ title, is_published: false })
      const created = response.data.assignment
      setAssignments(prev => [created, ...prev])
      setNewTitle('')
      setShowCreate(false)
    } catch (err) {
      console.error('Error creating assignment:', err)
      setCreateError('Failed to create assignment. Please try again.')
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto mb-3" />
          <p className="text-gray-600">Loading assignments...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <p className="text-gray-800 font-medium mb-2">Error</p>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    )
  }

  const isBusy = selectedId !== null || publishingId !== null

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-4">
        <h1 className="text-lg font-bold">Link a Simulation Assignment</h1>
        <p className="text-indigo-100 text-sm mt-1">
          Select a simulation to link to this Canvas assignment
        </p>
      </div>

      <div className="max-w-2xl mx-auto p-4">
        {/* Quick-create section */}
        {showCreate ? (
          <form onSubmit={handleCreate} className="bg-white rounded-lg border border-indigo-200 p-4 mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Assignment title
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Patient Interview Simulation"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                autoFocus
                disabled={creating}
              />
              <button
                type="submit"
                disabled={!newTitle.trim() || creating}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create
              </button>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setNewTitle(''); setCreateError(null) }}
                disabled={creating}
                className="px-3 py-2 text-gray-500 hover:text-gray-700 text-sm"
              >
                Cancel
              </button>
            </div>
            {createError && (
              <p className="text-red-600 text-xs mt-2">{createError}</p>
            )}
            <p className="text-gray-400 text-xs mt-2">
              You can configure the full details (persona, rubric, goals) later from the admin dashboard.
            </p>
          </form>
        ) : (
          <button
            onClick={() => setShowCreate(true)}
            disabled={isBusy}
            className="w-full mb-4 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg text-sm font-medium text-gray-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            Create New Assignment
          </button>
        )}

        {/* Assignment list */}
        {assignments.length === 0 && !showCreate ? (
          <div className="text-center py-8">
            <BookOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">
              No assignments yet. Create one above to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {assignments.map(assignment => (
              <div
                key={assignment.id}
                className="bg-white rounded-lg border border-gray-200 p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{assignment.title}</h3>
                      {!assignment.is_published && (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">Draft</span>
                      )}
                    </div>
                    {assignment.description && (
                      <p className="text-gray-500 text-sm mt-1 line-clamp-2">{assignment.description}</p>
                    )}
                    {assignment.persona_name && (
                      <p className="text-indigo-600 text-xs mt-2 font-medium">
                        Persona: {assignment.persona_name}
                      </p>
                    )}
                  </div>
                  {assignment.is_published ? (
                    <button
                      onClick={() => handleSelect(assignment.id)}
                      disabled={isBusy}
                      className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors flex-shrink-0 ${
                        selectedId === assignment.id
                          ? 'bg-indigo-100 text-indigo-700 cursor-wait'
                          : isBusy
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                    >
                      {selectedId === assignment.id ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Linking...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          Select
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={() => handlePublishAndLink(assignment.id)}
                      disabled={isBusy}
                      className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors flex-shrink-0 ${
                        publishingId === assignment.id
                          ? 'bg-amber-100 text-amber-700 cursor-wait'
                          : isBusy
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-amber-500 text-white hover:bg-amber-600'
                      }`}
                    >
                      {publishingId === assignment.id ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Publishing...
                        </>
                      ) : (
                        <>
                          <Globe className="w-4 h-4" />
                          Publish & Link
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default DeepLinkPicker
