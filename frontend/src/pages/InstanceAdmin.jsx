import React, { useEffect, useState, useCallback } from 'react'
import { instanceAPI } from '../utils/api'
import AdminNav from '../components/AdminNav'
import { useToast } from '../components/Toast'
import { formatDate } from '../utils/format'
import {
  Plug, Gauge, Cpu, Scale, ScrollText, Copy, Check, Plus, CheckCircle2, AlertTriangle, Circle, Zap, Download,
} from 'lucide-react'

// Instance administration, visible only to administrators of the LMS
// (route: /admin/instance). Everything here applies to the whole
// installation, not to one course.

const SECTIONS = [
  { id: 'overview', label: 'Setup', icon: Plug },
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'usage', label: 'Usage & limits', icon: Gauge },
  { id: 'grading', label: 'Grading agreement', icon: Scale },
  { id: 'audit', label: 'Audit log', icon: ScrollText },
]

const num = (v) => Number(v || 0).toLocaleString()
const usd = (v) => `$${Number(v || 0).toFixed(2)}`
const errorText = (err, fallback) => err?.response?.data?.error || fallback
const inputClass = 'px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none w-full bg-white'

// Prices are stored per 1,000 tokens and shown per 1,000,000, which is how
// providers quote them.
const toPerMillion = (per1k) => (per1k == null || per1k === '' ? '' : String(Number((Number(per1k) * 1000).toFixed(4))))
const toPer1k = (perMillion) => (perMillion === '' || perMillion == null ? '' : Number(perMillion) / 1000)

function Card({ title, children, action }) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      {(title || action) && (
        <div className="flex items-center justify-between gap-4 mb-4">
          <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

function Stat({ label, value, hint }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-2xl font-semibold text-gray-800 mt-1">{value}</div>
      {hint && <div className="text-xs text-gray-500 mt-1">{hint}</div>}
    </div>
  )
}

function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable inside some LMS frames */ }
  }
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
      <div className="w-44 shrink-0 text-sm text-gray-500">{label}</div>
      <code className="flex-1 text-sm text-gray-800 break-all">{value}</code>
      <button onClick={copy} className="p-1.5 text-gray-400 hover:text-primary-600" aria-label={`Copy ${label}`}>
        {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  )
}

function Table({ head, rows, empty }) {
  if (rows.length === 0) return <p className="text-sm text-gray-500">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-200">
            {head.map((h, i) => <th key={h} className={`py-2 pr-4 font-medium ${i > 0 ? 'whitespace-nowrap' : ''}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-0">
              {r.map((c, j) => <td key={j} className={`py-2 pr-4 text-gray-800 ${j === 0 ? 'break-words' : 'whitespace-nowrap'}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function useLoad(loader, deps = []) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const reload = useCallback(() => {
    setError(null)
    return loader()
      .then((res) => setData(res.data))
      .catch((err) => setError(errorText(err, 'Failed to load.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { reload() }, [reload])
  return { data, error, reload }
}

// Toast helper with the two tones this page uses.
function useNotify() {
  const { showToast } = useToast()
  return {
    success: (message) => showToast(message, 'success'),
    error: (message) => showToast(message, 'error'),
  }
}

const Loading = () => <p className="text-sm text-gray-500">Loading…</p>
const LoadError = ({ message }) => <p className="text-sm text-red-600">{message}</p>

// One-shot request to a model; shows the outcome inline.
function useModelTest() {
  const [state, setState] = useState({})
  const run = async (key, modelId) => {
    setState((s) => ({ ...s, [key]: { running: true } }))
    try {
      const { data } = await instanceAPI.testModel(modelId)
      setState((s) => ({ ...s, [key]: data }))
    } catch (err) {
      setState((s) => ({ ...s, [key]: { ok: false, error: errorText(err, 'The test request failed.') } }))
    }
  }
  return [state, run]
}

function TestResult({ result }) {
  if (!result) return null
  if (result.running) return <span className="text-sm text-gray-500">Testing…</span>
  if (result.ok) return <span className="text-sm text-green-700">Working ({(result.latency_ms / 1000).toFixed(1)}s)</span>
  return <span className="text-sm text-red-600 break-words">Failed: {result.error}</span>
}

// --------------------------------------------------------------------------
// Setup: what is configured, what is not, and how to fix it
// --------------------------------------------------------------------------
function CheckRow({ state, title, detail, action }) {
  const Icon = state === 'ok' ? CheckCircle2 : state === 'warn' ? AlertTriangle : Circle
  const tone = state === 'ok' ? 'text-green-600' : state === 'warn' ? 'text-amber-500' : 'text-gray-400'
  return (
    <li className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0">
      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${tone}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-800">{title}</div>
        {detail && <div className="text-sm text-gray-500 mt-0.5 break-words">{detail}</div>}
      </div>
      {action}
    </li>
  )
}

function Overview({ goTo }) {
  const { data, error } = useLoad(() => instanceAPI.getOverview())
  const [tests, runTest] = useModelTest()
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)

  const exportData = async () => {
    setExporting(true)
    setExportError(null)
    try {
      const res = await instanceAPI.exportData()
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `ltisim-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setExportError('The export could not be downloaded. Try again, or check the server log.')
    } finally {
      setExporting(false)
    }
  }

  if (error) return <LoadError message={error} />
  if (!data) return <Loading />
  const { lms, tool, ai, counts, checks, version, voice } = data
  const link = (section, text) => (
    <button onClick={() => goTo(section)} className="text-primary-700 underline">{text}</button>
  )

  return (
    <div className="space-y-6">
      <Card title="Setup checklist">
        <ul>
          <CheckRow
            state={checks.public_url_https ? 'ok' : 'warn'}
            title="Public address uses HTTPS"
            detail={checks.public_url_https
              ? checks.public_url
              : `${checks.public_url || 'PUBLIC_URL is not set'} — learning platforms only launch tools over HTTPS. Set PUBLIC_URL on the server.`}
          />
          <CheckRow
            state={checks.lms_verified ? 'ok' : 'warn'}
            title="Learning platform connected"
            detail={lms ? `${lms.name} (${lms.issuer})` : 'No learning platform is registered.'}
          />
          <CheckRow
            state={checks.models_listed > 0 ? 'ok' : 'warn'}
            title="Models listed"
            detail={checks.models_listed > 0
              ? `${checks.models_listed} model(s) available to instructors.`
              : <>No models yet. {link('models', 'Add the models your provider offers')}.</>}
          />
          <CheckRow
            state={checks.default_model_set ? 'ok' : 'warn'}
            title="Default model chosen"
            detail={checks.default_model_set
              ? ai.default_model
              : <>Assignments cannot run until a default is set. {link('models', 'Choose one under Models')}.</>}
          />
          <CheckRow
            state={tests.default?.ok ? 'ok' : tests.default && !tests.default.running ? 'warn' : 'todo'}
            title="AI provider responds"
            detail={
              <>
                This installation is set to use <strong>{ai.provider_name}</strong> (<code>AI_PROVIDER</code> on the
                server). The test sends one short request to the default model.
                {tests.default && <div className="mt-1"><TestResult result={tests.default} /></div>}
              </>
            }
            action={checks.default_model_set && (
              <button onClick={() => runTest('default')}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5 shrink-0">
                <Zap className="w-4 h-4" /> Test connection
              </button>
            )}
          />
          {voice && (
            <CheckRow
              state={voice.input === 'aws' || voice.mode === 'browser' || voice.mode === 'off' ? 'ok' : 'todo'}
              title="Voice (optional)"
              detail={
                <>
                  Voice does not use your AI provider. Spoken input:{' '}
                  <strong>{{ aws: 'Amazon Transcribe', browser: "the student's browser", off: 'off' }[voice.input]}</strong>
                  {voice.browser_fallback && " (the student's browser if Amazon fails)"}. Spoken replies:{' '}
                  <strong>{voice.replies ? 'Amazon Polly' : 'off'}</strong>.
                  {voice.region && <> AWS region {voice.region}.</>}
                  {voice.notes?.length > 0 && <> {voice.notes.join(' ')}</>}
                  {voice.input === 'browser' && (
                    <> Browser recognition works in some browsers only and usually sends audio to the browser's maker.</>
                  )}
                  {' '}Set with <code>VOICE_MODE</code> on the server (<code>auto</code>, <code>aws</code>,{' '}
                  <code>browser</code> or <code>off</code>); instructors turn voice on per assignment.
                </>
              }
            />
          )}
          <CheckRow
            state={checks.email_configured ? 'ok' : 'todo'}
            title="Outgoing email (optional)"
            detail={checks.email_configured
              ? <>The server can send email. Choose who receives usage alerts under {link('usage', 'Usage & limits')}.</>
              : (
                <>
                  Only used to send usage alerts. The mail server is configured on the server, not on this page,
                  because it needs a password: set <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>,
                  {' '}<code>SMTP_PASS</code> and <code>SMTP_FROM</code> in the server's environment and restart. The address
                  that receives alerts is then set under {link('usage', 'Usage & limits')}. Everything else works without email.
                </>
              )}
          />
        </ul>
      </Card>

      <Card title="Learning platform">
        {lms ? (
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div><dt className="text-gray-500">Name</dt><dd className="text-gray-800">{lms.name}</dd></div>
            <div><dt className="text-gray-500">Status</dt><dd className="text-gray-800 capitalize">{lms.status}</dd></div>
            <div><dt className="text-gray-500">Issuer</dt><dd className="text-gray-800 break-all">{lms.issuer}</dd></div>
            <div><dt className="text-gray-500">Client ID</dt><dd className="text-gray-800 break-all">{lms.client_id}</dd></div>
            <div><dt className="text-gray-500">Registered</dt><dd className="text-gray-800">{lms.registered_at ? formatDate(lms.registered_at) : '—'}</dd></div>
            <div><dt className="text-gray-500">First launch</dt><dd className="text-gray-800">{lms.first_launch_at ? formatDate(lms.first_launch_at) : '—'}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-gray-500">No learning platform is registered.</p>
        )}
        <p className="text-xs text-gray-500 mt-4">
          One installation serves one learning platform. Replacing it is done on the server
          (<code>npm run platform:reset</code>) because it removes all course data.
        </p>
      </Card>

      <Card title="Tool URLs">
        <p className="text-sm text-gray-500 mb-2">
          Derived from this installation's public address. Needed only if you configure the tool in your
          learning platform by hand.
        </p>
        <CopyRow label="Launch / target link" value={tool.target_link_uri} />
        <CopyRow label="OIDC login" value={tool.oidc_login_url} />
        <CopyRow label="Public keys (JWKS)" value={tool.jwks_url} />
        <CopyRow label="Redirect URI" value={tool.redirect_uris[0]} />
      </Card>

      <Card title="Export all data"
        action={
          <button onClick={exportData} disabled={exporting}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0">
            <Download className="w-4 h-4" /> {exporting ? 'Preparing…' : 'Download export'}
          </button>
        }>
        <p className="text-sm text-gray-500">
          One JSON file with everything this installation holds: courses, assignments, sessions and their full
          transcripts, grades, usage and settings. It contains student names, emails and conversations, so store it
          as you would any student record. Each export is recorded in the audit log.
        </p>
        {exportError && <p className="text-sm text-red-600 mt-2">{exportError}</p>}
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Courses" value={num(counts.courses)} />
        <Stat label="Assignments" value={num(counts.assignments)} />
        <Stat label="Sessions" value={num(counts.sessions)} />
        <Stat label="People" value={num(counts.users)} />
      </div>
      <p className="text-xs text-gray-400">LTISim {version}</p>
    </div>
  )
}

// --------------------------------------------------------------------------
// Models: what instructors can pick, the defaults, optional prices
// --------------------------------------------------------------------------
function Models() {
  const toast = useNotify()
  const { data, error, reload } = useLoad(() => instanceAPI.getModels())
  const [draft, setDraft] = useState({ model_id: '', name: '', input: '', output: '' })
  const [busy, setBusy] = useState(false)
  const [tests, runTest] = useModelTest()
  const [found, setFound] = useState(null)

  if (error) return <LoadError message={error} />
  if (!data) return <Loading />
  const small = 'px-2 py-1.5 border-2 border-gray-200 rounded-lg focus:border-primary-500 focus:outline-none w-full text-sm bg-white'
  const available = data.models.filter((m) => m.is_available)

  const patch = async (id, changes) => {
    try {
      await instanceAPI.updateModel(id, changes)
      await reload()
    } catch (err) {
      toast.error(errorText(err, 'Could not update the model.'))
    }
  }
  const setDefault = async (field, value) => {
    try {
      await instanceAPI.updateSettings({ [field]: value })
      toast.success('Default updated')
      await reload()
    } catch (err) {
      toast.error(errorText(err, 'Could not update the default.'))
    }
  }
  const add = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await instanceAPI.addModel({
        model_id: draft.model_id,
        name: draft.name,
        input_cost_per_1k: toPer1k(draft.input),
        output_cost_per_1k: toPer1k(draft.output),
      })
      setDraft({ model_id: '', name: '', input: '', output: '' })
      toast.success('Model added')
      await reload()
    } catch (err) {
      toast.error(errorText(err, 'Could not add the model.'))
    } finally {
      setBusy(false)
    }
  }

  const discover = async () => {
    setFound({ loading: true })
    try {
      const res = await instanceAPI.discoverModels()
      setFound(res.data)
    } catch (err) {
      setFound({ supported: true, models: [], error: errorText(err, 'The request failed.') })
    }
  }
  const addFound = async (m) => {
    try {
      await instanceAPI.addModel({ model_id: m.id, name: m.name })
      setFound((f) => ({ ...f, models: f.models.map((x) => (x.id === m.id ? { ...x, listed: true } : x)) }))
      await reload()
    } catch (err) {
      toast.error(errorText(err, 'Could not add the model.'))
    }
  }

  // A default that comes from the server environment shows as the inherited
  // choice; picking a model here overrides it.
  const inherited = (field, envVar, fallbackText) => {
    const source = data.default_sources[field]
    if (source === 'environment') return `From ${envVar} on the server (${data[field]})`
    return fallbackText
  }

  return (
    <div className="space-y-6">
      <Card title="Defaults">
        <p className="text-sm text-gray-500 mb-4">
          Used by every assignment that does not choose its own model. Provider: <strong>{data.provider_name}</strong>
          {' '}(set with <code>AI_PROVIDER</code> on the server, alongside its credentials).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            Conversation model
            <select className={inputClass} value={data.settings.default_model || ''}
              onChange={(e) => setDefault('default_model', e.target.value)}>
              <option value="">{inherited('default_model', 'AI_MODEL', 'Not set')}</option>
              {available.map((m) => <option key={m.model_id} value={m.model_id}>{m.name}</option>)}
            </select>
            <span className="text-xs font-normal text-gray-500">Plays the role in the conversation with the student.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            Grading model
            <select className={inputClass} value={data.settings.default_grading_model || ''}
              onChange={(e) => setDefault('default_grading_model', e.target.value)}>
              <option value="">{inherited('default_grading_model', 'AI_GRADING_MODEL', 'Same as the conversation model')}</option>
              {available.map((m) => <option key={m.model_id} value={m.model_id}>{m.name}</option>)}
            </select>
            <span className="text-xs font-normal text-gray-500">
              Scores sessions against the rubric and helps instructors draft assignments. Use your strongest model here.
            </span>
          </label>
        </div>
        {!data.default_model && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mt-4">
            No default conversation model is set, so assignments cannot run yet. Add a model below, then choose it here.
          </p>
        )}
      </Card>

      <Card title="Available models">
        <p className="text-sm text-gray-500 mb-4">
          Instructors can choose any model ticked as available. Prices are optional and yours to enter: they feed
          only the spend figures and the monthly budget, and are never shown to instructors.
        </p>
        {data.models.length === 0 ? (
          <p className="text-sm text-gray-500">
            No models listed yet. Add the model IDs your {data.provider_name} account can use, then test each one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Model ID</th>
                  <th className="py-2 pr-4 font-medium whitespace-nowrap">Input $ / 1M tokens</th>
                  <th className="py-2 pr-4 font-medium whitespace-nowrap">Output $ / 1M tokens</th>
                  <th className="py-2 pr-4 font-medium">Available</th>
                  <th className="py-2 font-medium">Test</th>
                </tr>
              </thead>
              <tbody>
                {data.models.map((m) => (
                  <tr key={m.id} className="border-b border-gray-100 last:border-0 align-middle">
                    <td className="py-2 pr-4 min-w-[10rem]">
                      <input className={small} defaultValue={m.name} aria-label="Display name"
                        onBlur={(e) => e.target.value.trim() && e.target.value !== m.name && patch(m.id, { name: e.target.value })} />
                    </td>
                    <td className="py-2 pr-4 text-gray-600 break-all">{m.model_id}</td>
                    {['input_cost_per_1k', 'output_cost_per_1k'].map((f) => (
                      <td key={f} className="py-2 pr-4 w-32">
                        <input className={small} type="number" min="0" step="any" placeholder="Not set"
                          defaultValue={toPerMillion(m[f])} aria-label={f.startsWith('input') ? 'Input price' : 'Output price'}
                          onBlur={(e) => e.target.value !== toPerMillion(m[f]) && patch(m.id, { [f]: toPer1k(e.target.value) })} />
                      </td>
                    ))}
                    <td className="py-2 pr-4">
                      <input type="checkbox" className="w-4 h-4 accent-primary-600" checked={m.is_available}
                        onChange={(e) => patch(m.id, { is_available: e.target.checked })}
                        aria-label={`${m.name} available`} />
                    </td>
                    <td className="py-2 max-w-xs">
                      <div className="flex items-center gap-2">
                        <button onClick={() => runTest(m.id, m.model_id)}
                          className="px-2.5 py-1 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 shrink-0">
                          Test
                        </button>
                        <TestResult result={tests[m.id]} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Find models from your provider"
        action={
          <button onClick={discover} disabled={found?.loading}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 shrink-0">
            {found?.loading ? 'Asking…' : 'List models'}
          </button>
        }>
        {!found && (
          <p className="text-sm text-gray-500">
            Asks {data.provider_name} which models your account can use, so you can add them without typing IDs.
          </p>
        )}
        {found && !found.loading && found.supported === false && (
          <p className="text-sm text-gray-500">
            {data.provider_name} cannot be asked for a model list from here. Add model IDs by hand below, then test each one.
          </p>
        )}
        {found?.error && <p className="text-sm text-red-600 break-words">Could not list models: {found.error}</p>}
        {found?.models?.length > 0 && (
          <ul className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {found.models.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="text-gray-800">{m.name}</span>
                  {m.name !== m.id && <span className="text-gray-500 break-all"> ({m.id})</span>}
                </span>
                {m.listed ? (
                  <span className="text-gray-400 shrink-0">Added</span>
                ) : (
                  <button onClick={() => addFound(m)}
                    className="px-2.5 py-1 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 shrink-0">
                    Add
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {found && !found.loading && found.supported && !found.error && found.models.length === 0 && (
          <p className="text-sm text-gray-500">The provider returned no models.</p>
        )}
      </Card>

      <Card title="Add a model by ID">
        <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700 md:col-span-2">
            Model ID
            <input className={small} required value={draft.model_id} placeholder="Exactly as your provider names it"
              onChange={(e) => setDraft({ ...draft, model_id: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            Display name
            <input className={small} value={draft.name} placeholder="Shown to instructors"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            Input $ / 1M tokens
            <input className={small} type="number" min="0" step="any" placeholder="Optional" value={draft.input}
              onChange={(e) => setDraft({ ...draft, input: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            Output $ / 1M tokens
            <input className={small} type="number" min="0" step="any" placeholder="Optional" value={draft.output}
              onChange={(e) => setDraft({ ...draft, output: e.target.value })} />
          </label>
          <div className="md:col-span-5">
            <button type="submit" disabled={busy}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Add model
            </button>
          </div>
        </form>
      </Card>
    </div>
  )
}

// --------------------------------------------------------------------------
// Usage & limits
// --------------------------------------------------------------------------
function QuotaBar({ label, used, limit, format }) {
  if (limit == null) return <p className="text-sm text-gray-600">{label}: {format(used)} this month, no limit set</p>
  const pct = Number(limit) > 0 ? Math.min(100, (Number(used) / Number(limit)) * 100) : 100
  const tone = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-primary-500'
  return (
    <div>
      <div className="flex justify-between text-sm text-gray-700 mb-1">
        <span>{label}</span>
        <span>{format(used)} of {format(limit)}</span>
      </div>
      <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Usage({ goTo }) {
  const toast = useNotify()
  const { data, error, reload } = useLoad(() => instanceAPI.getUsage())
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data && !form) {
      setForm({
        monthly_ai_call_limit: data.settings.monthly_ai_call_limit ?? '',
        monthly_ai_budget_usd: data.settings.monthly_ai_budget_usd ?? '',
        alert_email: data.settings.alert_email ?? '',
      })
    }
  }, [data, form])

  if (error) return <LoadError message={error} />
  if (!data || !form) return <Loading />
  const { summary, by_model, by_call_type, top_assignments, month_to_date, settings, daily } = data
  const maxDaily = Math.max(1, ...daily.map((d) => d.calls))
  // Spend means something only once at least one call has had a price.
  const spendTracked = summary.calls > summary.unpriced_calls
  const spend = (value, calls, unpriced) => (calls > 0 && unpriced >= calls ? 'Not tracked' : usd(value))
  const modelsLink = <button onClick={() => goTo('models')} className="underline">Models</button>

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await instanceAPI.updateSettings(form)
      toast.success('Limits saved')
      await reload()
    } catch (err) {
      toast.error(errorText(err, 'Could not save the limits.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card title="This month">
        <div className="space-y-4">
          <QuotaBar label="AI calls" used={month_to_date.calls} limit={settings.monthly_ai_call_limit} format={num} />
          {settings.monthly_ai_budget_usd != null || month_to_date.calls > month_to_date.unpriced_calls ? (
            <QuotaBar label="Spend" used={month_to_date.cost_usd} limit={settings.monthly_ai_budget_usd} format={usd} />
          ) : (
            <p className="text-sm text-gray-600">Spend: not tracked. Enter model prices under {modelsLink} to see it.</p>
          )}
          {month_to_date.unpriced_calls > 0 && (settings.monthly_ai_budget_usd != null || spendTracked) && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              {num(month_to_date.unpriced_calls)} call(s) this month used a model with no price, so they are missing
              from spend and do not count toward the budget. Set prices under {modelsLink}, or rely on the call limit.
            </p>
          )}
        </div>
      </Card>

      <Card title="Monthly limits">
        <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            AI call limit
            <input className={inputClass} type="number" min="0" step="1" placeholder="No limit"
              value={form.monthly_ai_call_limit}
              onChange={(e) => setForm({ ...form, monthly_ai_call_limit: e.target.value })} />
            <span className="text-xs font-normal text-gray-500">Works with any model. One student message is one call.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            Budget (USD)
            <input className={inputClass} type="number" min="0" step="0.01" placeholder="No limit"
              value={form.monthly_ai_budget_usd}
              onChange={(e) => setForm({ ...form, monthly_ai_budget_usd: e.target.value })} />
            <span className="text-xs font-normal text-gray-500">Counts only models that have prices entered.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            Alert email
            <input className={inputClass} type="email" placeholder="admin@example.edu"
              value={form.alert_email}
              onChange={(e) => setForm({ ...form, alert_email: e.target.value })} />
            <span className="text-xs font-normal text-gray-500">Notified at 80% and 100%, if the server can send email.</span>
          </label>
          <div className="md:col-span-3 flex items-center justify-between gap-4">
            <p className="text-xs text-gray-500">
              At a limit, new chats, previews and drafting help are blocked until next month. Grading of finished
              sessions always continues, so no student is left without a result.
            </p>
            <button type="submit" disabled={saving}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50 shrink-0">
              {saving ? 'Saving…' : 'Save limits'}
            </button>
          </div>
        </form>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Calls, all time" value={num(summary.calls)} />
        <Stat label="Tokens, all time" value={num(summary.tokens)} />
        <Stat label="Spend, all time" value={spend(summary.cost_usd, summary.calls, summary.unpriced_calls)}
          hint={spendTracked && summary.unpriced_calls > 0 ? `${num(summary.unpriced_calls)} call(s) had no price` : undefined} />
      </div>

      <Card title="Calls per day, last 30 days">
        {daily.length === 0 ? <p className="text-sm text-gray-500">No AI calls yet.</p> : (
          <div className="flex items-end gap-1 h-32" role="img" aria-label="Bar chart of AI calls per day">
            {daily.map((d) => (
              <div key={d.day} className="flex-1 bg-primary-400 rounded-t"
                style={{ height: `${Math.max(4, (d.calls / maxDaily) * 100)}%` }}
                title={`${String(d.day).slice(0, 10)}: ${num(d.calls)} calls`} />
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="By model">
          <Table head={['Model', 'Calls', 'Tokens', 'Spend']} empty="No AI calls yet."
            rows={by_model.map((m) => [m.model_id, num(m.calls), num(m.tokens), m.cost_usd == null ? 'No price' : usd(m.cost_usd)])} />
        </Card>
        <Card title="By type of call">
          <Table head={['Type', 'Calls', 'Tokens']} empty="No AI calls yet."
            rows={by_call_type.map((t) => [t.call_type, num(t.calls), num(t.tokens)])} />
        </Card>
      </div>

      <Card title="Most active assignments">
        <Table head={['Assignment', 'Course', 'Calls', 'Tokens', 'Spend']} empty="No AI calls yet."
          rows={top_assignments.map((a) => [a.title || 'Drafting help (no assignment)', a.course_name || '—', num(a.calls), num(a.tokens), a.cost_usd == null ? 'No price' : usd(a.cost_usd)])} />
      </Card>
    </div>
  )
}

// --------------------------------------------------------------------------
// Grading agreement
// --------------------------------------------------------------------------
function Grading() {
  const { data, error } = useLoad(() => instanceAPI.getGradingAgreement())
  if (error) return <LoadError message={error} />
  if (!data) return <Loading />
  const { summary, by_confidence, by_assignment } = data
  const rate = (m, p) => (p > 0 ? `${Math.round((m / p) * 100)}%` : '—')
  return (
    <div className="space-y-6">
      <Card title="How often the AI grade matches the instructor's">
        <p className="text-sm text-gray-500 mb-4">
          This is your own evidence for how well your chosen grading model performs on your rubrics. It is built
          from sessions where an instructor graded before seeing the AI's grade; each pair is one rubric criterion
          scored by both.
        </p>
        {summary.pairs === 0 ? (
          <p className="text-sm text-gray-500">
            No blind-graded sessions yet. Instructors record these from a session's review page, and a few dozen
            are worth collecting before relying on automatic release of grades.
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Same level" value={rate(summary.level_matches, summary.pairs)} hint={`${num(summary.level_matches)} of ${num(summary.pairs)} criteria`} />
            <Stat label="Average score gap" value={summary.score_mae ?? '—'} hint={summary.score_mae_pct != null ? `${summary.score_mae_pct}% of available points` : undefined} />
            <Stat label="Sessions" value={num(summary.sessions)} />
            <Stat label="Assignments" value={num(summary.assignments)} />
          </div>
        )}
      </Card>
      {summary.pairs > 0 && (
        <>
          <Card title="By the AI's stated confidence">
            <Table head={['Confidence', 'Criteria', 'Same level', 'Average score gap']} empty=""
              rows={by_confidence.map((c) => [c.confidence, num(c.pairs), rate(c.level_matches, c.pairs), c.score_mae ?? '—'])} />
          </Card>
          <Card title="By assignment">
            <Table head={['Assignment', 'Course', 'Sessions', 'Criteria', 'Same level', 'Average score gap']} empty=""
              rows={by_assignment.map((a) => [a.assignment_title, a.course_name || '—', num(a.sessions), num(a.pairs), rate(a.level_matches, a.pairs), a.score_mae ?? '—'])} />
          </Card>
        </>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------
// Audit log
// --------------------------------------------------------------------------
const PAGE = 50
const eventLabel = (t) => {
  const text = String(t).replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
const detailText = (metadata) => {
  const entries = Object.entries(metadata || {})
  if (entries.length === 0) return '—'
  return entries
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v === null ? 'cleared' : typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ')
}

function Audit() {
  const [eventType, setEventType] = useState('')
  const [offset, setOffset] = useState(0)
  const { data, error } = useLoad(
    () => instanceAPI.getAuditEvents({ event_type: eventType || undefined, limit: PAGE, offset }),
    [eventType, offset]
  )
  if (error) return <LoadError message={error} />
  if (!data) return <Loading />
  return (
    <Card title="Audit log"
      action={
        <select value={eventType} onChange={(e) => { setOffset(0); setEventType(e.target.value) }}
          className="px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm bg-white" aria-label="Filter by event">
          <option value="">All events</option>
          {data.event_types.map((t) => <option key={t} value={t}>{eventLabel(t)}</option>)}
        </select>
      }>
      <p className="text-sm text-gray-500 mb-4">
        Registration, rejected launches, and every change made in this area.
      </p>
      <Table head={['When', 'Event', 'By', 'Details']} empty="No events recorded."
        rows={data.events.map((e) => [
          formatDate(e.created_at),
          eventLabel(e.event_type),
          e.actor_type === 'system' ? 'System' : (e.actor_name || 'Administrator'),
          <span className="whitespace-normal break-words">{detailText(e.metadata)}</span>,
        ])} />
      {data.total > PAGE && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
          <span>{offset + 1}–{Math.min(offset + PAGE, data.total)} of {num(data.total)}</span>
          <div className="flex gap-2">
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}
              className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40">Previous</button>
            <button disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </Card>
  )
}

// --------------------------------------------------------------------------
const VIEWS = { overview: Overview, usage: Usage, models: Models, grading: Grading, audit: Audit }

function InstanceAdmin({ user }) {
  const [section, setSection] = useState('overview')
  const View = VIEWS[section]

  if (!user?.is_instance_admin) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-100">
        <AdminNav user={user} />
        <main className="p-8 text-gray-600">This area is for administrators of your learning platform.</main>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      <AdminNav user={user} />
      <main className="flex-1 p-8 max-w-6xl w-full mx-auto">
        <div className="flex flex-wrap gap-2 mb-6" role="tablist" aria-label="Instance sections">
          {SECTIONS.map((s) => (
            <button key={s.id} role="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)}
              className={`px-3.5 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 border ${
                section === s.id ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}>
              <s.icon className="w-4 h-4" />
              {s.label}
            </button>
          ))}
        </div>
        <View goTo={setSection} />
      </main>
    </div>
  )
}

export default InstanceAdmin
