import React, { useState, useRef, useEffect } from 'react'
import { Send, UserCircle, User, MessageSquare, Loader2, Mic, MicOff } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { startTranscribeStream, MicDeniedError } from '../utils/transcribe-client'

const SpeechRecognition = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null

// Voice engine: AWS Transcribe streaming first (all browsers, per-assignment
// vocabulary biasing); Web Speech API as automatic fallback when the streaming
// path is down. Once Transcribe fails pre-transcript we stop retrying it for
// the rest of the page load.
let transcribeDead = false

function ChatInterface({ interactions, onSendMessage, disabled, isTyping, personaName, voiceEnabled = false, sessionId = null }) {
  const [message, setMessage] = useState('')
  const [listening, setListening] = useState(false)
  const [voiceHint, setVoiceHint] = useState('')
  // Set when the current input text came (mostly) from speech; the flag rides
  // along to the server as input_mode for later voice-vs-typed analytics.
  const [spokeInput, setSpokeInput] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const recognitionRef = useRef(null) // Web Speech engine (fallback)
  const streamRef = useRef(null) // Transcribe engine handle
  const baseTextRef = useRef('')

  // Transcribe streaming works in every browser with a mic, so the button
  // shows whenever the assignment enables voice and capture exists.
  const voiceSupported =
    voiceEnabled &&
    typeof window !== 'undefined' &&
    (!!navigator.mediaDevices?.getUserMedia || !!SpeechRecognition)

  const stopListening = () => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    streamRef.current?.stop()
    streamRef.current = null
    setListening(false)
  }

  const startWebSpeech = () => {
    if (!SpeechRecognition) {
      setVoiceHint('Voice input is unavailable right now — you can type instead.')
      return
    }
    const rec = new SpeechRecognition()
    recognitionRef.current = rec
    rec.lang = navigator.language || 'en-US'
    rec.interimResults = true
    rec.continuous = true
    rec.onresult = (event) => {
      let transcript = ''
      for (const result of event.results) transcript += result[0].transcript
      setMessage(baseTextRef.current + transcript)
      setSpokeInput(true)
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    rec.start()
    setListening(true)
  }

  const toggleListening = async () => {
    if (listening) {
      stopListening()
      return
    }
    setVoiceHint('')
    baseTextRef.current = message ? message.trimEnd() + ' ' : ''

    if (!transcribeDead && sessionId) {
      try {
        const handle = await startTranscribeStream({
          sessionId,
          onTranscript: ({ stable, unstable }) => {
            const joined = stable + (stable && unstable ? ' ' : '') + unstable
            setMessage(baseTextRef.current + joined)
            setSpokeInput(true)
          },
          onEnd: () => {
            streamRef.current = null
            setListening(false)
          },
          onError: () => {
            streamRef.current = null
            setListening(false)
          },
        })
        streamRef.current = handle
        setListening(true)
        return
      } catch (err) {
        if (err instanceof MicDeniedError) {
          setVoiceHint('Voice input needs microphone access — allow it in your browser, or type instead.')
          return
        }
        transcribeDead = true // fall through to Web Speech below
      }
    }
    startWebSpeech()
  }

  useEffect(() => () => {
    recognitionRef.current?.stop()
    streamRef.current?.stop()
  }, [])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [interactions, isTyping])

  // Auto-grow the input with its content (voice dictation adds whole
  // sentences) up to ~6 lines, then scroll inside; while listening, keep the
  // newest words visible.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 168) + 'px'
    if (listening) el.scrollTop = el.scrollHeight
  }, [message, listening])

  const handleSubmit = (e) => {
    e.preventDefault()

    if (!message.trim() || disabled || isTyping) {
      return
    }

    if (listening) stopListening()
    const text = message.trim()
    setMessage('')
    onSendMessage(text, spokeInput ? 'voice' : 'typed')
    setSpokeInput(false)

    // Re-focus the input after sending
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="bg-white rounded-lg shadow-md flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4" role="log" aria-live="polite" aria-label="Conversation messages">
        {interactions.length === 0 && !isTyping ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
              <MessageSquare className="w-7 h-7 text-gray-300" />
            </div>
            <p className="text-sm">Start the simulation by sending a message below.</p>
          </div>
        ) : (
          interactions.map((interaction) => (
            interaction.metadata?.type === 'stage_divider' ? (
              <div key={interaction.id} className="flex items-center gap-3 my-2 self-stretch">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                  {interaction.content.replace(/^\[|\]$/g, '')}
                </span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            ) : (
            <div
              key={interaction.id}
              className={`flex gap-3 max-w-[85%] md:max-w-[80%] ${
                interaction.role === 'user' ? 'self-end flex-row-reverse' : 'self-start'
              }`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                interaction.role === 'user'
                  ? 'bg-gradient-to-br from-navy-600 to-navy-800'
                  : 'bg-gradient-to-br from-teal-500 to-teal-700'
              }`}>
                {interaction.role === 'user'
                  ? <User className="w-4 h-4 text-white" />
                  : <UserCircle className="w-4 h-4 text-white" />
                }
              </div>
              <div className="flex flex-col gap-1.5 min-w-0">
                <div className={`flex items-center gap-2 text-xs ${
                  interaction.role === 'user' ? 'justify-end' : ''
                }`}>
                  <span className="font-semibold text-gray-500">
                    {interaction.role === 'user' ? 'You' : (personaName || 'Assistant')}
                  </span>
                  <span className="text-gray-400">
                    {formatTimestamp(interaction.timestamp)}
                  </span>
                </div>
                <div
                  className={`px-4 py-3 rounded-2xl leading-relaxed text-sm ${
                    interaction.role === 'user'
                      ? 'bg-teal-500 text-white whitespace-pre-wrap'
                      : 'bg-navy-50 text-navy-800 prose prose-sm max-w-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-2 prose-pre:my-2 prose-pre:bg-navy-100 prose-code:bg-navy-100 prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none'
                  }`}
                >
                  {interaction.role === 'user' ? (
                    interaction.content
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{interaction.content}</ReactMarkdown>
                  )}
                </div>
              </div>
            </div>
            )
          ))
        )}

        {isTyping && (
          <div className="self-start flex gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center flex-shrink-0">
              <UserCircle className="w-4 h-4 text-white" />
            </div>
            <div className="flex items-center gap-1.5 px-4 py-3 bg-navy-50 rounded-2xl">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {voiceHint && (
        <p className="px-5 pt-2 text-xs text-amber-600">{voiceHint}</p>
      )}
      <form onSubmit={handleSubmit} className="flex items-end gap-3 px-5 py-3 border-t border-gray-200">
        <textarea
          ref={inputRef}
          rows={1}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit(e)
            }
          }}
          placeholder={
            disabled
              ? 'Message limit reached — please complete the simulation'
              : isTyping
              ? 'Waiting for response...'
              : 'Type your message...'
          }
          disabled={disabled}
          className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-sm leading-relaxed resize-none overflow-y-auto focus:border-primary-500 focus:outline-none disabled:bg-gray-100 disabled:cursor-not-allowed transition-colors"
        />
        {voiceSupported && (
          <button
            type="button"
            onClick={toggleListening}
            disabled={disabled}
            title={listening ? 'Stop listening' : 'Speak your message (you can edit it before sending)'}
            aria-label={listening ? 'Stop voice input' : 'Start voice input'}
            className={`px-4 py-3 rounded-lg text-sm font-semibold transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed ${
              listening ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
        )}
        <button
          type="submit"
          disabled={disabled || isTyping || !message.trim()}
          className="px-4 py-3 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isTyping ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </form>
    </div>
  )
}

export default ChatInterface
