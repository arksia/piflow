import type { ChatMessage, ModelInfo, SessionInfoLite, SessionView, ToolState } from './types'

export interface SessionState {
  key: string
  sessionFile?: string | null
  messages: ChatMessage[]
  isStreaming: boolean
  model: ModelInfo | null
  thinkingLevel?: string | null
  thinkingLevels?: string[]
  context?: SessionView['context']
}

export interface AgentEvent {
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

export type ServerMessage
  = | { type: 'hello', cwd: string }
    | { type: 'sessions', sessions: SessionInfoLite[] }
    | { type: 'models', models: ModelInfo[] }
    | { type: 'state', state: SessionState }
    | { type: 'event', session: string, event: AgentEvent, context?: SessionView['context'] }
    | { type: 'error', error: string, session?: string }
