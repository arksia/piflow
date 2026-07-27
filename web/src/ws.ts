import { reactive } from 'vue'
import { RequestTracker } from './request-tracker'

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
  type: 'usage'
  provider: string
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

export const store = reactive({
  connected: false,
  cwd: '',
  sessions: [] as SessionInfoLite[],
  models: [] as ModelInfo[],
  usage: {} as Record<string, UsageReport>,
  activeKey: null as string | null,
  draft: '',
  views: {} as Record<string, SessionView>,
  sidebarOpen: false,
})

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

// ---------- ws connection ----------

let ws: WebSocket | null = null

interface SessionState {
  key: string
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
    | UsageReport
    | { type: 'state', state: SessionState, requestId?: string }
    | { type: 'event', session: string, event: AgentEvent, context?: SessionView['context'] }
    | { type: 'error', error: string, session?: string, requestId?: string }

const sessionRequests = new RequestTracker<SessionState>()

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

  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ws`)

  ws.onopen = () => {
    store.connected = true
    send({ type: 'list_sessions' })
    send({ type: 'list_models' })
  }
  ws.onclose = () => {
    store.connected = false
    ws = null
    sessionRequests.rejectAll(new Error('connection closed'))
    setTimeout(connect, 1500)
  }
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as ServerMessage
    route(msg)
  }
}

function send(msg: Record<string, unknown>): boolean {
  if (ws?.readyState !== WebSocket.OPEN)
    return false
  ws.send(JSON.stringify(msg))
  return true
}

function route(msg: ServerMessage) {
  switch (msg.type) {
    case 'hello':
      store.cwd = msg.cwd
      break

    case 'sessions':
      store.sessions = msg.sessions
      break

    case 'models':
      store.models = msg.models
      break

    case 'usage':
      if (msg.provider)
        store.usage[msg.provider] = msg
      break

    case 'state': {
      const s = msg.state
      const view = ensureView(s.key)
      view.messages = s.messages
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
      // ponytail: single-user local tool; full message sync via state broadcast
      view.toolResults = results
      view.tick++
      if (msg.requestId)
        sessionRequests.resolve(msg.requestId, s)
      break
    }

    case 'event':
      if (msg.context !== undefined)
        ensureView(msg.session).context = msg.context
      handleEvent(msg.session, msg.event)
      break

    case 'error': {
      if (msg.requestId)
        sessionRequests.reject(msg.requestId, new Error(msg.error))
      if (msg.session)
        ensureView(msg.session).error = msg.error
      console.error('[piflow]', msg.error)
      break
    }
  }
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
}

// ---------- public API ----------

export function requestSessions() {
  send({ type: 'list_sessions' })
}

function requestSession(message: { type: 'open', path: string } | { type: 'new' }): Promise<SessionState> {
  const requestId = crypto.randomUUID()
  const response = sessionRequests.wait(requestId)
  if (!send({ ...message, requestId }))
    sessionRequests.reject(requestId, new Error('not connected'))
  return response.then((state) => {
    store.activeKey = state.key
    return state
  })
}

export function openSession(path: string): Promise<SessionState> {
  return requestSession({ type: 'open', path })
}

export function newSession(): Promise<SessionState> {
  return requestSession({ type: 'new' })
}

export async function sendPrompt(text: string): Promise<void> {
  if (!store.connected)
    throw new Error('not connected')
  if (!store.activeKey)
    await newSession()
  const key = store.activeKey
  if (!key)
    return
  if (!send({ type: 'prompt', key, text }))
    throw new Error('not connected')
  const view = ensureView(key)
  view.messages.push({ role: 'user', content: text, timestamp: Date.now() })
  view.tick++
}

export function abort(key: string) {
  send({ type: 'abort', key })
}

export function setModel(key: string, provider: string, modelId: string) {
  send({ type: 'set_model', key, provider, modelId })
}

export function setThinking(key: string, level: string) {
  send({ type: 'set_thinking', key, level })
}

export function requestUsage(key: string, fresh = false) {
  send({ type: 'get_usage', key, fresh })
}

export function initWs() {
  void connect()
}
