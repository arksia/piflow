import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { JsonAgentSessionEvent, RpcExtensionUIRequest } from '@earendil-works/pi-coding-agent'
import type {
  ServerMessage,
  SessionInfoLite,
  SessionState,
  SessionStatusRecord,
} from '@piflow/protocol'
import type { ToolState } from './state'
import { readSavedActivePath, saveActiveSessionFile } from './persistence'
import { ensureView, notify, store } from './store'

let restored = false

type AssistantMessage = Extract<AgentMessage, { role: 'assistant' }>
type MessageUpdate = Extract<JsonAgentSessionEvent, { type: 'message_update' }>['assistantMessageEvent']
const toolCallArgumentJson = new Map<string, string>()

function sameMessage(a: AgentMessage | undefined, b: AgentMessage) {
  return a && a.role === b.role && JSON.stringify(a) === JSON.stringify(b)
}

export function applyAssistantUpdate(message: AssistantMessage, update: MessageUpdate): AssistantMessage {
  const content = [...message.content]
  const current = 'contentIndex' in update ? content[update.contentIndex] : undefined

  switch (update.type) {
    case 'text_start':
      content[update.contentIndex] = { type: 'text', text: '' }
      break
    case 'text_delta':
      content[update.contentIndex] = {
        type: 'text',
        text: (current?.type === 'text' ? current.text : '') + update.delta,
      }
      break
    case 'text_end':
      content[update.contentIndex] = { type: 'text', text: update.content }
      break
    case 'thinking_start':
      content[update.contentIndex] = { type: 'thinking', thinking: '' }
      break
    case 'thinking_delta':
      content[update.contentIndex] = {
        type: 'thinking',
        thinking: (current?.type === 'thinking' ? current.thinking : '') + update.delta,
      }
      break
    case 'thinking_end':
      content[update.contentIndex] = { type: 'thinking', thinking: update.content }
      break
    case 'toolcall_start':
      toolCallArgumentJson.set(update.id, '')
      content[update.contentIndex] = {
        type: 'toolCall',
        id: update.id,
        name: update.toolName,
        arguments: {},
      }
      break
    case 'toolcall_delta':
      if (current?.type === 'toolCall') {
        const json = (toolCallArgumentJson.get(current.id) ?? '') + update.delta
        toolCallArgumentJson.set(current.id, json)
        content[update.contentIndex] = { ...current, arguments: parseToolArguments(json) }
      }
      break
    case 'toolcall_end':
      toolCallArgumentJson.delete(update.toolCall.id)
      content[update.contentIndex] = update.toolCall
      break
  }

  return { ...message, content }
}

function parseToolArguments(json: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  }
  catch {
    return {}
  }
}

export function applySessions(sessions: SessionInfoLite[], restoreSession: (path: string) => void) {
  store.sessions = sessions
  notify()
  if (!restored && !store.activeKey) {
    restored = true
    const savedPath = readSavedActivePath()
    if (savedPath && sessions.some(session => session.path === savedPath))
      restoreSession(savedPath)
  }
}

export function applyState(state: SessionState) {
  const view = ensureView(state.key)
  view.cwd = state.cwd
  view.sessionFile = state.sessionFile ?? null
  view.messages = state.messages
  view.live = null
  view.isStreaming = state.isStreaming
  view.isCompacting = state.isCompacting
  view.model = state.model
  view.thinkingLevel = state.thinkingLevel ?? null
  view.thinkingLevels = state.thinkingLevels ?? []
  view.context = state.context ?? null
  view.extensionRequests = state.extensionRequests
  view.queue = state.queue
  view.error = state.error

  const results: Record<string, ToolState> = {}
  for (const message of state.messages) {
    if (message.role === 'toolResult' && message.toolCallId && Array.isArray(message.content)) {
      results[message.toolCallId] = {
        result: { content: message.content, details: message.details },
        isError: message.isError,
      }
    }
  }

  view.toolResults = results
  view.tick++
  if (state.key === store.activeKey)
    saveActiveSessionFile(state.sessionFile)
  notify()
}

export function handleEvent(key: string, event: JsonAgentSessionEvent) {
  const view = ensureView(key)
  view.tick++

  switch (event.type) {
    case 'agent_start':
      view.isStreaming = true
      view.error = null
      break

    case 'agent_settled':
      view.isStreaming = false
      view.live = null
      break

    case 'message_start':
      if (event.message.role === 'assistant')
        view.live = event.message
      break

    case 'message_update':
      if (view.live?.role === 'assistant')
        view.live = applyAssistantUpdate(view.live, event.assistantMessageEvent)
      break

    case 'message_end': {
      const message = event.message
      if (message.role === 'assistant') {
        view.live = null
        const last = view.messages[view.messages.length - 1]
        if (!sameMessage(last, message))
          view.messages.push(message)
      }
      break
    }

    case 'tool_execution_start':
      view.toolResults = {
        ...view.toolResults,
        [event.toolCallId]: { running: true, args: event.args },
      }
      break

    case 'tool_execution_update': {
      const previous = view.toolResults[event.toolCallId]
      view.toolResults = {
        ...view.toolResults,
        [event.toolCallId]: { ...previous, partial: event.partialResult },
      }
      break
    }

    case 'tool_execution_end':
      view.toolResults = {
        ...view.toolResults,
        [event.toolCallId]: { result: event.result, isError: event.isError },
      }
      break

    case 'compaction_start':
      view.isCompacting = true
      break

    case 'compaction_end':
      view.isCompacting = false
      break

    case 'queue_update':
      view.queue = { steering: event.steering, followUp: event.followUp }
      break
  }

  notify()
}

export function applyStatusSnapshot(statuses: SessionStatusRecord[]) {
  const next: Record<string, SessionStatusRecord> = {}
  for (const record of statuses)
    next[record.sessionFile ?? record.key] = record
  store.statuses = next
  notify()
}

export function applyStatusDelta(status: SessionStatusRecord) {
  const key = status.sessionFile ?? status.key
  const current = store.statuses[key]
  if (!current || status.updatedAt >= current.updatedAt) {
    store.statuses[key] = status
    notify()
  }
}

export function route(message: ServerMessage, restoreSession: (path: string) => void) {
  switch (message.type) {
    case 'hello':
      store.cwd = message.cwd
      notify()
      break

    case 'sessions':
      applySessions(message.sessions, restoreSession)
      break

    case 'models':
      store.models = message.models
      notify()
      break

    case 'state':
      applyState(message.state)
      break

    case 'status_snapshot':
      applyStatusSnapshot(message.statuses)
      break

    case 'status_delta':
      applyStatusDelta(message.status)
      break

    case 'extension_ui_request': {
      const request = message as RpcExtensionUIRequest & { session: string }
      // Notices are fire-and-forget: the server never tracks them as pending,
      // so they live outside view state until the user dismisses them.
      if (request.method === 'notify') {
        store.extensionNotices = [...store.extensionNotices, { session: request.session, request }]
        notify()
        break
      }
      if (request.method === 'setTitle') {
        document.title = request.title || 'piflow'
        break
      }
      if (request.method === 'set_editor_text') {
        window.dispatchEvent(new CustomEvent('piflow:set-editor-text', { detail: { session: request.session, text: request.text } }))
        break
      }
      if (request.method !== 'select'
        && request.method !== 'confirm'
        && request.method !== 'input'
        && request.method !== 'editor'
        && request.method !== 'setStatus'
        && request.method !== 'setWidget') {
        break
      }
      const view = ensureView(request.session)
      const retained = view.extensionRequests.filter((existing) => {
        if (request.method === 'setStatus' && existing.method === 'setStatus')
          return existing.statusKey !== request.statusKey
        if (request.method === 'setWidget' && existing.method === 'setWidget')
          return existing.widgetKey !== request.widgetKey
        return existing.id !== request.id
      })
      if ((request.method !== 'setStatus' || request.statusText !== undefined)
        && (request.method !== 'setWidget' || request.widgetLines !== undefined)) {
        retained.push(request)
      }
      view.extensionRequests = retained
      view.tick++
      notify()
      break
    }

    case 'event':
      if (message.context !== undefined)
        ensureView(message.session).context = message.context
      handleEvent(message.session, message.event)
      break

    case 'error':
      if (message.session)
        ensureView(message.session).error = message.error
      console.error('[piflow]', message.error)
      notify()
      break
  }
}
