import React, { useState, useRef, useEffect } from 'react'
import { adminAPI } from '../../utils/api'
import { RotateCcw, Send, MessageSquare } from 'lucide-react'

function PreviewChat({ assignmentId, saved, welcomeMessage }) {
  const initialMessages = welcomeMessage
    ? [{ role: 'assistant', content: welcomeMessage }]
    : []
  const [messages, setMessages] = useState(initialMessages)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (e) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    if (!saved) {
      setError('Please save the assignment first before previewing.')
      return
    }

    const userMsg = input.trim()
    setInput('')
    setError(null)

    const history = messages.map((m) => ({ role: m.role, content: m.content }))
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }])
    setLoading(true)

    let started = false
    try {
      const final = await adminAPI.previewAssignmentStream(assignmentId, userMsg, history, (delta) => {
        setLoading(false)
        setMessages((prev) => {
          if (!started) {
            started = true
            return [...prev, { role: 'assistant', content: delta, streaming: true }]
          }
          const copy = [...prev]
          const last = copy[copy.length - 1]
          copy[copy.length - 1] = { ...last, content: last.content + delta }
          return copy
        })
      })
      // Replace the streamed message with the server-final content
      setMessages((prev) => {
        const copy = started ? prev.slice(0, -1) : [...prev]
        return [...copy, { role: 'assistant', content: final.content }]
      })
    } catch (err) {
      if (started) setMessages((prev) => prev.slice(0, -1))
      const detail = err.response?.data?.details || err.response?.data?.error || err.message
      setError(`Preview failed: ${detail}`)
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setMessages(welcomeMessage ? [{ role: 'assistant', content: welcomeMessage }] : [])
    setError(null)
  }

  return (
    <div className="border border-gray-200 rounded-lg flex flex-col h-96">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200 rounded-t-lg">
        <span className="text-sm font-semibold text-gray-600">Preview Chat</span>
        <button
          type="button"
          onClick={handleReset}
          className="text-xs text-primary-500 hover:text-primary-700 font-medium inline-flex items-center gap-1"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
            <MessageSquare className="w-8 h-8 text-gray-300" />
            <p className="text-sm text-center">
              {saved
                ? 'Send a message to test your AI persona.'
                : 'Save the assignment first, then test your AI persona here.'}
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex flex-col max-w-[80%] ${msg.role === 'user' ? 'self-end items-end' : 'self-start items-start'}`}
          >
            <span className="text-xs text-gray-400 mb-1">
              {msg.role === 'user' ? 'You' : 'AI'}
            </span>
            <div
              className={`px-3 py-2 rounded-lg text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary-500 text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-800 rounded-bl-sm'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-1 text-gray-400 self-start">
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-50 text-red-600 text-xs border-t border-red-100">
          {error}
        </div>
      )}

      <form onSubmit={handleSend} className="flex gap-2 p-3 border-t border-gray-200">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a test message..."
          disabled={loading || !saved}
          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-primary-500 focus:outline-none disabled:bg-gray-50"
        />
        <button
          type="submit"
          disabled={loading || !input.trim() || !saved}
          className="px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  )
}

export default PreviewChat
