export interface SessionInfoLite {
  path: string
  id: string
  cwd: string
  name: string | null
  created: string
  modified: string
  messageCount: number
  firstMessage: string
}

export interface DirectoryEntry {
  name: string
  path: string
}

export interface DirectoryListing {
  path: string
  parent: string | null
  directories: DirectoryEntry[]
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
}

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ImageBlock {
  type: 'image'
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}

export interface ToolCallBlock {
  type: 'toolCall'
  id: string
  name: string
  arguments?: Record<string, unknown>
}

export type MessageBlock = TextBlock | ImageBlock | ThinkingBlock | ToolCallBlock

export interface ChatMessage {
  role: string
  content?: string | MessageBlock[]
  timestamp?: number
  stopReason?: string
  errorMessage?: string
  command?: string
  output?: string
  exitCode?: number
  toolCallId?: string
  details?: Record<string, unknown>
  isError?: boolean
}

export interface UsageWindow {
  minutes: number
  limit: number
  used: number
  remaining: number
  resetTime?: string
}

export interface UsageReport {
  provider: string | null
  supported: boolean
  plan?: string
  windows: UsageWindow[]
}

export interface ToolState {
  running?: boolean
  args?: unknown
  partial?: { content?: Array<{ type: string, text?: string }> }
  result?: { content?: Array<{ type: string, text?: string }>, details?: Record<string, unknown> }
  isError?: boolean
}

export interface SessionView {
  key: string
  messages: ChatMessage[]
  live: ChatMessage | null
  isStreaming: boolean
  isCompacting: boolean
  model: ModelInfo | null
  thinkingLevel: string | null
  thinkingLevels: string[]
  context: { tokens: number, contextWindow: number, percent: number } | null
  toolResults: Record<string, ToolState>
  queue: { steering: readonly string[], followUp: readonly string[] }
  error: string | null
  tick: number
}

export interface StoreState {
  connected: boolean
  cwd: string
  sessions: SessionInfoLite[]
  models: ModelInfo[]
  usage: Record<string, UsageReport>
  activeKey: string | null
  views: Record<string, SessionView>
  sidebarOpen: boolean
}

const listeners = new Set<() => void>()
let version = 0
let flushTimer: ReturnType<typeof setTimeout> | undefined

function notify() {
  version++
  // token-level events can fire 100+/s; coalesce renders to ~25fps
  if (flushTimer)
    return
  flushTimer = setTimeout(() => {
    flushTimer = undefined
    for (const listener of listeners)
      listener()
  }, 40)
}

export const store: StoreState = {
  connected: false,
  cwd: '',
  sessions: [],
  models: [],
  usage: {},
  activeKey: null,
  views: {},
  sidebarOpen: false,
}

export function subscribeStore(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getStoreVersion(): number {
  return version
}

export function setSidebarOpen(open: boolean) {
  store.sidebarOpen = open
  notify()
}

function ensureView(key: string): SessionView {
  return (store.views[key] ??= {
    key,
    messages: [],
    live: null,
    isStreaming: false,
    isCompacting: false,
    model: null,
    thinkingLevel: null,
    thinkingLevels: [],
    context: null,
    toolResults: {},
    queue: { steering: [], followUp: [] },
    error: null,
    tick: 0,
  })
}

// ---------- protocol types ----------

interface SessionState {
  key: string
  sessionFile?: string | null
  messages: ChatMessage[]
  isStreaming: boolean
  model: ModelInfo | null
  thinkingLevel?: string | null
  thinkingLevels?: string[]
  context?: SessionView['context']
}

interface AgentEvent {
  type: string
  message?: ChatMessage
  toolCallId?: string
  args?: unknown
  partialResult?: ToolState['partial']
  result?: ToolState['result']
  isError?: boolean
  steering?: readonly string[]
  followUp?: readonly string[]
}

type ServerMessage
  = | { type: 'hello', cwd: string }
    | { type: 'sessions', sessions: SessionInfoLite[] }
    | { type: 'models', models: ModelInfo[] }
    | { type: 'state', state: SessionState }
    | { type: 'event', session: string, event: AgentEvent, context?: SessionView['context'] }
    | { type: 'error', error: string, session?: string }

// ---------- last opened session ----------

const ACTIVE_KEY = 'piflow.active'
let restored = false

function saveActive(s: SessionState) {
  if (s.sessionFile)
    localStorage.setItem(ACTIVE_KEY, JSON.stringify({ path: s.sessionFile }))
}

function readSavedActive(): { path: string } | null {
  try {
    return JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? 'null')
  }
  catch {
    return null
  }
}

// ---------- http api ----------

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options)
  const data: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = (data as { error?: unknown }).error
    throw new Error(typeof message === 'string' ? message : `request failed: ${response.status}`)
  }
  return data as T
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

function sessionUrl(key: string, action: string) {
  return `/api/sessions/${encodeURIComponent(key)}/${action}`
}

// ---------- state application ----------

function applySessions(sessions: SessionInfoLite[]) {
  store.sessions = sessions
  notify()
  // restore the last opened session after refresh (only if it still exists)
  if (!restored && !store.activeKey) {
    restored = true
    const saved = readSavedActive()
    if (saved?.path && sessions.some(s => s.path === saved.path))
      openSession(saved.path).catch(() => {})
  }
}

function applyState(s: SessionState) {
  const view = ensureView(s.key)
  view.messages = s.messages
  // state is authoritative; streaming events rebuild live from here
  view.live = null
  view.isStreaming = s.isStreaming
  view.model = s.model
  view.thinkingLevel = s.thinkingLevel ?? null
  view.thinkingLevels = s.thinkingLevels ?? []
  view.context = s.context ?? null
  view.error = null
  // rebuild tool results from history
  const results: Record<string, ToolState> = {}
  for (const m of s.messages) {
    if (m.role === 'toolResult' && m.toolCallId && Array.isArray(m.content)) {
      results[m.toolCallId] = { result: { content: m.content, details: m.details }, isError: m.isError }
    }
  }
  view.toolResults = results
  view.tick++
  // once a new session is persisted to disk, update the last-opened record
  if (s.key === store.activeKey)
    saveActive(s)
  notify()
}

function sameMessage(a: ChatMessage | undefined, b: ChatMessage) {
  return a && b && a.role === b.role && JSON.stringify(a.content) === JSON.stringify(b.content)
}

function handleEvent(key: string, ev: AgentEvent) {
  const view = ensureView(key)
  view.tick++

  switch (ev.type) {
    case 'agent_start':
      view.isStreaming = true
      view.error = null
      break

    case 'agent_settled':
      view.isStreaming = false
      view.live = null
      break

    case 'message_start':
      if (ev.message?.role === 'assistant')
        view.live = ev.message
      break

    case 'message_update':
      if (ev.message?.role === 'assistant')
        view.live = ev.message
      break

    case 'message_end': {
      const m = ev.message
      if (!m)
        break
      if (m.role === 'assistant') {
        view.live = null
        const last = view.messages[view.messages.length - 1]
        if (!sameMessage(last, m))
          view.messages.push(m)
      }
      break
    }

    case 'tool_execution_start':
      if (!ev.toolCallId)
        break
      view.toolResults[ev.toolCallId] = { running: true, args: ev.args }
      break

    case 'tool_execution_update': {
      if (!ev.toolCallId)
        break
      const t = (view.toolResults[ev.toolCallId] ??= {})
      t.partial = ev.partialResult
      break
    }

    case 'tool_execution_end':
      if (!ev.toolCallId)
        break
      view.toolResults[ev.toolCallId] = { result: ev.result, isError: ev.isError }
      break

    case 'compaction_start':
      view.isCompacting = true
      break

    case 'compaction_end':
      view.isCompacting = false
      break

    case 'queue_update':
      view.queue = { steering: ev.steering ?? [], followUp: ev.followUp ?? [] }
      break
  }
  notify()
}

function route(msg: ServerMessage) {
  switch (msg.type) {
    case 'hello':
      store.cwd = msg.cwd
      notify()
      break

    case 'sessions':
      applySessions(msg.sessions)
      break

    case 'models':
      store.models = msg.models
      notify()
      break

    case 'state':
      applyState(msg.state)
      break

    case 'event':
      if (msg.context !== undefined)
        ensureView(msg.session).context = msg.context
      handleEvent(msg.session, msg.event)
      break

    case 'error': {
      if (msg.session)
        ensureView(msg.session).error = msg.error
      console.error('[piflow]', msg.error)
      notify()
      break
    }
  }
}

// ---------- sse connection ----------

async function connect() {
  try {
    const url = new URL(location.href)
    const token = url.searchParams.get('token')
    const authUrl = token ? `/auth?token=${encodeURIComponent(token)}` : '/auth'
    const response = await fetch(authUrl, { cache: 'no-store' })
    if (!response.ok)
      throw new Error(`authentication failed: ${response.status}`)
    if (token) {
      url.searchParams.delete('token')
      history.replaceState(null, '', url)
    }
  }
  catch (error) {
    console.error('[piflow]', error)
    setTimeout(connect, 1500)
    return
  }

  const source = new EventSource('/api/events')

  source.onopen = () => {
    store.connected = true
    notify()
    void resync()
  }

  source.onmessage = (e) => {
    route(JSON.parse(String(e.data)) as ServerMessage)
  }

  // EventSource reconnects automatically
  source.onerror = () => {
    if (store.connected) {
      store.connected = false
      notify()
    }
  }
}

async function resync() {
  try {
    const [sessions, models] = await Promise.all([
      api<{ sessions: SessionInfoLite[] }>('/api/sessions'),
      api<{ models: ModelInfo[] }>('/api/models'),
    ])
    store.models = models.models
    applySessions(sessions.sessions)
    // refresh authoritative state for the active session after (re)connect
    const key = store.activeKey
    if (key && !key.startsWith('new:'))
      await openSession(key)
  }
  catch (error) {
    console.error('[piflow]', error)
  }
}

// ---------- public API ----------

async function requestSession(path: string, body: unknown): Promise<SessionState> {
  const { state } = await post<{ state: SessionState }>(path, body)
  applyState(state)
  store.activeKey = state.key
  saveActive(state)
  notify()
  return state
}

export function openSession(path: string): Promise<SessionState> {
  return requestSession('/api/sessions/open', { path })
}

export function newSession(): Promise<SessionState> {
  return requestSession('/api/sessions/new', store.cwd ? { cwd: store.cwd } : {})
}

export function newSessionIn(cwd: string): Promise<SessionState> {
  return requestSession('/api/sessions/new', { cwd })
}

export async function requestDirectories(path: string): Promise<DirectoryListing> {
  const { listing } = await api<{ listing: DirectoryListing }>(`/api/directories?path=${encodeURIComponent(path)}`)
  return listing
}

export async function sendPrompt(text: string): Promise<void> {
  if (!store.connected)
    throw new Error('not connected')
  if (!store.activeKey)
    await newSession()
  const key = store.activeKey
  if (!key)
    return
  await post(sessionUrl(key, 'prompt'), { text })
  const view = ensureView(key)
  view.messages.push({ role: 'user', content: text, timestamp: Date.now() })
  view.tick++
  notify()
}

export function abort(key: string) {
  void post(sessionUrl(key, 'abort')).catch((error: unknown) => console.error('[piflow]', error))
}

export function setModel(key: string, provider: string, modelId: string) {
  void post(sessionUrl(key, 'model'), { provider, modelId }).catch((error: unknown) => console.error('[piflow]', error))
}

export function setThinking(key: string, level: string) {
  void post(sessionUrl(key, 'thinking'), { level }).catch((error: unknown) => console.error('[piflow]', error))
}

export function requestUsage(key: string, fresh = false) {
  void api<UsageReport>(`/api/usage?key=${encodeURIComponent(key)}${fresh ? '&fresh=1' : ''}`)
    .then((report) => {
      if (report.provider)
        store.usage[report.provider] = report
      notify()
    })
    .catch((error: unknown) => console.error('[piflow]', error))
}

export function initClient() {
  void connect()
}
