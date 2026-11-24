import React, { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import SimulationRouter from './pages/SimulationRouter'
import StudentDashboard from './pages/StudentDashboard'
import AdminDashboard from './pages/AdminDashboard'
import AdminSessions from './pages/AdminSessions'
import AdminAnalytics from './pages/AdminAnalytics'
import AdminStudents from './pages/AdminStudents'
import AdminReview from './pages/AdminReview'
import AdminSessionPage from './pages/AdminSessionPage'
import InstanceAdmin from './pages/InstanceAdmin'
import AssignmentEditor from './pages/AssignmentEditor'
import DeepLinkPicker from './pages/DeepLinkPicker'
import ErrorPage from './pages/ErrorPage'
import LoadingPage from './pages/LoadingPage'
import { ToastProvider } from './components/Toast'
import { getLTIToken } from './utils/lti'
import { simulationAPI } from './utils/api'
import { isInstructor } from './utils/roles'

// -----------------------------------------------------------------------
// LTI App — the student/instructor experience launched from the LMS
// -----------------------------------------------------------------------

function LTIApp() {
  const [ltik, setLtik] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    initializeApp()
  }, [])

  const initializeApp = async () => {
    try {
      const token = getLTIToken()
      if (token) {
        setLtik(token)
        sessionStorage.setItem('ltik', token)
      } else {
        const storedToken = sessionStorage.getItem('ltik')
        if (storedToken) {
          setLtik(storedToken)
        } else {
          setError('No LTI token found. Please launch this application from Canvas.')
          setLoading(false)
          return
        }
      }
      const userResponse = await simulationAPI.getUser()
      setUser(userResponse.data.user)
      setLoading(false)
    } catch (err) {
      console.error('Error initializing app:', err)
      setError('Failed to initialize application. Please try again.')
      setLoading(false)
    }
  }

  if (loading) return <LoadingPage />
  if (error) return <ErrorPage message={error} />

  return (
    <Routes>
      <Route
        path="/"
        element={
          user && isInstructor(user)
            ? <Navigate to={user.has_course === false ? '/admin/instance' : '/admin'} replace />
            : <StudentDashboard ltik={ltik} user={user} />
        }
      />
      <Route path="/admin" element={<AdminDashboard ltik={ltik} user={user} />} />
      <Route path="/admin/instance" element={<InstanceAdmin ltik={ltik} user={user} />} />
      <Route path="/admin/students" element={<AdminStudents ltik={ltik} user={user} />} />
      <Route path="/admin/review" element={<AdminReview ltik={ltik} user={user} />} />
      <Route path="/admin/sessions/:sessionId" element={<AdminSessionPage ltik={ltik} user={user} />} />
      <Route path="/admin/deep-link" element={<DeepLinkPicker ltik={ltik} user={user} />} />
      <Route path="/admin/assignments/new" element={<AssignmentEditor ltik={ltik} user={user} />} />
      <Route path="/admin/assignments/:assignmentId/edit" element={<AssignmentEditor ltik={ltik} user={user} />} />
      <Route path="/admin/assignments/:assignmentId/sessions" element={<AdminSessions ltik={ltik} user={user} />} />
      <Route path="/admin/assignments/:assignmentId/analytics" element={<AdminAnalytics ltik={ltik} user={user} />} />
      <Route path="/simulation" element={<SimulationRouter ltik={ltik} user={user} />} />
      <Route path="/session-timeout" element={<ErrorPage message="Your session has expired. Please relaunch from your learning platform." />} />
      <Route path="/invalid-token" element={<ErrorPage message="Invalid authentication token. Please relaunch from your learning platform." />} />
    </Routes>
  )
}

// -----------------------------------------------------------------------
// Root App
// -----------------------------------------------------------------------

function App() {
  return (
    <ToastProvider>
      <Router>
        <Routes>
          <Route path="/*" element={<LTIApp />} />
        </Routes>
      </Router>
    </ToastProvider>
  )
}

export default App
