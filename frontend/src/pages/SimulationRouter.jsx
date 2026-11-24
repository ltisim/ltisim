import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { simulationAPI } from '../utils/api'
import SimulationPage from './SimulationPage'
import LLMInteractionPage from './LLMInteractionPage'
import LoadingPage from './LoadingPage'
import ErrorPage from './ErrorPage'

// Thin wrapper that decides which student page to render based on the
// assignment_type. The chosen page then performs its own initialization.
function SimulationRouter({ ltik, user }) {
  const [searchParams] = useSearchParams()
  const [type, setType] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    const resolveType = async () => {
      try {
        const assignmentId = searchParams.get('assignmentId')
        const sessionId = searchParams.get('sessionId')

        if (assignmentId) {
          const res = await simulationAPI.getAssignment(assignmentId)
          if (!cancelled) setType(res.data.assignment.assignment_type || 'simulation')
          return
        }

        if (sessionId) {
          const res = await simulationAPI.getSession(sessionId)
          if (!cancelled) setType(res.data.session.assignment_type || 'simulation')
          return
        }

        if (!cancelled) setType('simulation')
      } catch (err) {
        console.error('Failed to resolve assignment type:', err)
        if (!cancelled) setError('Failed to load activity. Please try again.')
      }
    }

    resolveType()
    return () => { cancelled = true }
  }, [searchParams])

  if (error) return <ErrorPage message={error} />
  if (!type) return <LoadingPage />
  if (type === 'llm_interaction') return <LLMInteractionPage ltik={ltik} user={user} />
  return <SimulationPage ltik={ltik} user={user} />
}

export default SimulationRouter
