import axios from 'axios'
import { getStoredToken } from './lti'
import { streamPost } from './stream'

// Same-origin: the backend serves this bundle, so no URL is baked in at build time.
const API_BASE_URL = ''

/**
 * Create axios instance with default config
 */
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

/**
 * Add LTI token to requests
 */
api.interceptors.request.use((config) => {
  const token = getStoredToken()
  if (token) {
    config.headers['x-lti-token'] = token
  }
  return config
})

/**
 * Simulation API
 */
export const simulationAPI = {
  // Get current user info
  getUser: () => api.get('/api/simulation/user'),

  // Get all assignments for student's course
  getAssignments: () => api.get('/api/simulation/assignments'),

  // Get current student's sessions
  getMySessions: () => api.get('/api/simulation/my-sessions'),

  // Get student-safe assignment details
  getAssignment: (assignmentId) => api.get(`/api/simulation/assignments/${assignmentId}`),

  // Create new simulation session
  createSession: (assignmentId, practice = false) =>
    api.post('/api/simulation/session', { assignmentId, ...(practice && { practice: true }) }),

  // Get session by ID
  getSession: (sessionId) => api.get(`/api/simulation/session/${sessionId}`),

  // Chat - send message and get AI response
  // Streaming chat: onDelta(text) fires per chunk; resolves with the final
  // { userInteraction, aiInteraction, completionStatus } payload
  chatStream: (sessionId, content, onDelta, inputMode) =>
    streamPost(`/api/simulation/session/${sessionId}/chat`, { content, input_mode: inputMode }, onDelta),

  chat: (sessionId, content) =>
    api.post(`/api/simulation/session/${sessionId}/chat`, { content }),

  // Evaluate and complete session
  evaluateAndComplete: (sessionId, payload) =>
    api.post(`/api/simulation/session/${sessionId}/evaluate-and-complete`, payload || {}),

  // Staged simulations: advance to the next stage (server checks the minimum)
  advanceStage: (sessionId) => api.post(`/api/simulation/session/${sessionId}/advance-stage`),

  // Artifact write-up autosave
  saveArtifactDraft: (sessionId, text) =>
    api.patch(`/api/simulation/session/${sessionId}/artifact-draft`, { text }),

  // Voice mode: synthesize an assistant reply as speech (mp3 blob)
  tts: (sessionId, interactionId) =>
    api.post(`/api/simulation/session/${sessionId}/tts`, { interactionId }, { responseType: 'blob' }),

  // Add interaction to session (legacy)
  addInteraction: (sessionId, data) =>
    api.post(`/api/simulation/session/${sessionId}/interaction`, data),

  // Get all interactions for session
  getInteractions: (sessionId) =>
    api.get(`/api/simulation/session/${sessionId}/interactions`),

  // Complete session (legacy)
  completeSession: (sessionId, score) =>
    api.post(`/api/simulation/session/${sessionId}/complete`, { score }),
}

/**
 * Grades API
 */
export const gradesAPI = {
  // Submit grade to Canvas
  submitGrade: (sessionId, score) =>
    api.post('/api/grades/submit', { sessionId, score }),

  // Get grade submissions for session
  getSubmissions: (sessionId) => api.get(`/api/grades/session/${sessionId}`),
}

/**
 * Admin API
 */
export const adminAPI = {
  // Get all sessions for the course
  getSessions: () => api.get('/api/admin/sessions'),

  // Get detailed session information
  getSessionDetail: (sessionId) => api.get(`/api/admin/sessions/${sessionId}`),

  // Add feedback to a session
  addFeedback: (sessionId, data) =>
    api.post(`/api/admin/sessions/${sessionId}/feedback`, data),

  // Update feedback
  updateFeedback: (feedbackId, data) =>
    api.put(`/api/admin/feedback/${feedbackId}`, data),

  // Delete feedback
  deleteFeedback: (feedbackId) => api.delete(`/api/admin/feedback/${feedbackId}`),

  // Get course statistics
  getStats: () => api.get('/api/admin/stats'),

  // Get current course details
  getCourse: () => api.get('/api/admin/course'),

  // AI provider and selectable models for this instance
  getAiModels: () => api.get('/api/admin/ai-models'),

  // Get all enrollments for the course
  getEnrollments: () => api.get('/api/admin/course/enrollments'),

  // Update course details
  updateCourse: (data) => api.put('/api/admin/course', data),

  // Get all assignments for the course
  getAssignments: () => api.get('/api/admin/assignments'),

  // Get single assignment with full config
  getAssignment: (assignmentId) => api.get(`/api/admin/assignments/${assignmentId}`),

  // Create a new assignment
  createAssignment: (data) => api.post('/api/admin/assignments', data),

  // Update an assignment
  updateAssignment: (assignmentId, data) =>
    api.put(`/api/admin/assignments/${assignmentId}`, data),

  // Preview assignment AI config
  previewAssignment: (assignmentId, message, history) =>
    api.post(`/api/admin/assignments/${assignmentId}/preview`, { message, history }),

  // Streaming preview: onDelta(text) per chunk; resolves with { content, usage }
  previewAssignmentStream: (assignmentId, message, history, onDelta) =>
    streamPost(`/api/admin/assignments/${assignmentId}/preview`, { message, history }, onDelta),

  // Delete an assignment
  deleteAssignment: (assignmentId) => api.delete(`/api/admin/assignments/${assignmentId}`),

  // Save evaluation edits without releasing
  saveEvaluation: (sessionId, data) => api.put(`/api/admin/sessions/${sessionId}/evaluation`, data),

  // Release a pending-review session to the student
  releaseSession: (sessionId, data) => api.post(`/api/admin/sessions/${sessionId}/release`, data),

  // Promote a completed session into rubric exemplars
  promoteSessionToExemplars: (assignmentId, data) =>
    api.post(`/api/admin/assignments/${assignmentId}/exemplars-from-session`, data),

  // Regrade a single pending-review session with the current rubric
  regradeSession: (sessionId) => api.post(`/api/admin/sessions/${sessionId}/regrade`),

  // Retry grade passback for a session whose submission failed
  retryGrade: (sessionId) => api.post(`/api/admin/sessions/${sessionId}/retry-grade`),

  // Regrade all pending-review sessions for an assignment with the current rubric
  regradePendingForAssignment: (assignmentId) =>
    api.post(`/api/admin/assignments/${assignmentId}/regrade-pending`),

  // Release all pending-review sessions for an assignment
  releasePending: (assignmentId) =>
    api.post(`/api/admin/assignments/${assignmentId}/release-pending`),

  // Blind grading: record instructor grades made without seeing the AI draft
  blindGrade: (sessionId, grades) =>
    api.post(`/api/admin/sessions/${sessionId}/blind-grade`, { grades }),

  // Human-vs-AI grading agreement stats for an assignment
  getAgreement: (assignmentId) =>
    api.get(`/api/admin/assignments/${assignmentId}/agreement`),

  // Criterion-level analytics for an assignment (latest attempt per student)
  getAnalytics: (assignmentId) =>
    api.get(`/api/admin/assignments/${assignmentId}/analytics`),

  // Course roster: students × assignments completion matrix
  getRoster: () => api.get('/api/admin/course/roster'),

  // CSV of all attempts with per-criterion scores (blob — auth is in headers,
  // so a plain link can't download it)
  exportResultsCsv: (assignmentId) =>
    api.get(`/api/admin/assignments/${assignmentId}/export.csv`, { responseType: 'blob' }),

  // --- Authoring assist + reuse (routes/authoring.js) ---
  generateDraft: (description, assignmentType) =>
    api.post('/api/admin/assignments/generate-draft', { description, assignment_type: assignmentType }),
  refineField: (assignment, field, instruction) =>
    api.post('/api/admin/assignments/refine-field', { assignment, field, instruction }),
  critiqueRubric: (payload) => api.post('/api/admin/assignments/critique-rubric', payload),
  testGrade: (assignmentId, transcript) =>
    api.post(`/api/admin/assignments/${assignmentId}/test-grade`, { transcript }),
  duplicateAssignment: (assignmentId, targetContextId) =>
    api.post(`/api/admin/assignments/${assignmentId}/duplicate`, { target_context_id: targetContextId }),
  exportAssignment: (assignmentId) =>
    api.get(`/api/admin/assignments/${assignmentId}/export`, { responseType: 'blob' }),
  importAssignment: (data) => api.post('/api/admin/assignments/import', { data }),
  listTemplates: () => api.get('/api/admin/assignment-templates'),
  createFromTemplate: (templateId) =>
    api.post('/api/admin/assignments/from-template', { template_id: templateId }),
  getMyCourses: () => api.get('/api/admin/my-courses'),
}

/**
 * Instance administration (LMS administrators only)
 */
export const instanceAPI = {
  getOverview: () => api.get('/api/instance/overview'),
  updateSettings: (settings) => api.patch('/api/instance/settings', settings),
  getUsage: (params) => api.get('/api/instance/usage', { params }),
  getModels: () => api.get('/api/instance/ai-models'),
  addModel: (model) => api.post('/api/instance/ai-models', model),
  updateModel: (id, changes) => api.patch(`/api/instance/ai-models/${id}`, changes),
  exportData: () => api.get('/api/instance/export', { responseType: 'blob' }),
  discoverModels: () => api.get('/api/instance/ai-models/discover'),
  testModel: (modelId) => api.post('/api/instance/ai-test', { model_id: modelId }),
  getGradingAgreement: () => api.get('/api/instance/grading-agreement'),
  getAuditEvents: (params) => api.get('/api/instance/audit-events', { params }),
}

export default api
