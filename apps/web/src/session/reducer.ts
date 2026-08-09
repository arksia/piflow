import type {
  AgentEvent,
  ChatMessage,
  ServerMessage,
  SessionInfoLite,
  SessionState,
} from '@piflow/protocol'
import type { ToolState } from './state'
import { readSavedActivePath, saveActiveSessionFile } from './persistence'
import { ensureView, notify, store } from './store'

let restored = false

function sameMessage(a: ChatMessage | undefined, b: ChatMessage) {
  return a && b && a.role === b.role && JSON.stringify(a.content) === JSON.stringify(b.content)
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
  view.sessionFile = state.sessionFile ?? null
  view.messages = state.messages
  view.live = null
  view.isStreaming = state.isStreaming
  view.model = state.model
  view.thinkingLevel = state.thinkingLevel ?? null
  view.thinkingLevels = state.thinkingLevels ?? []
  view.context = state.context ?? null
  view.error = null

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

export function handleEvent(key: string, event: AgentEvent) {
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
      if (event.message?.role === 'assistant')
        view.live = event.message
      break

    case 'message_update':
      if (event.message?.role === 'assistant')
        view.live = event.message
      break

    case 'message_end': {
      const message = event.message
      if (!message)
        break
      if (message.role === 'assistant') {
        view.live = null
        const last = view.messages[view.messages.length - 1]
        if (!sameMessage(last, message))
          view.messages.push(message)
      }
      break
    }

    case 'tool_execution_start':
      if (!event.toolCallId)
        break
      view.toolResults = {
        ...view.toolResults,
        [event.toolCallId]: { running: true, args: event.args },
      }
      break

    case 'tool_execution_update': {
      if (!event.toolCallId)
        break
      const previous = view.toolResults[event.toolCallId]
      view.toolResults = {
        ...view.toolResults,
        [event.toolCallId]: { ...previous, partial: event.partialResult },
      }
      break
    }

    case 'tool_execution_end':
      if (!event.toolCallId)
        break
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
      view.queue = { steering: event.steering ?? [], followUp: event.followUp ?? [] }
      break
  }

  notify()
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
