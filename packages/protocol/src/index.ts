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

export interface SessionContext {
  tokens: number
  contextWindow: number
  percent: number
}

export interface ToolContentPart {
  type: string
  text?: string
}

export interface ToolExecutionPayload {
  content?: ToolContentPart[]
  details?: Record<string, unknown>
}

export interface SessionState {
  key: string
  sessionId?: string
  sessionFile?: string | null
  messages: ChatMessage[]
  isStreaming: boolean
  model: ModelInfo | null
  thinkingLevel?: string | null
  thinkingLevels?: string[]
  context?: SessionContext | null
}

export interface AgentEvent {
  type: string
  message?: ChatMessage
  toolCallId?: string
  args?: unknown
  partialResult?: ToolExecutionPayload
  result?: ToolExecutionPayload
  isError?: boolean
  steering?: readonly string[]
  followUp?: readonly string[]
}

export type ServerMessage
  = | { type: 'hello', cwd: string }
    | { type: 'sessions', sessions: SessionInfoLite[] }
    | { type: 'models', models: ModelInfo[] }
    | { type: 'state', state: SessionState }
    | { type: 'event', session: string, event: AgentEvent, context?: SessionContext | null }
    | { type: 'error', error: string, session?: string }

export interface HelloResponse {
  cwd: string
}

export interface SessionsResponse {
  sessions: SessionInfoLite[]
}

export interface ModelsResponse {
  models: ModelInfo[]
}

export interface DirectoriesResponse {
  listing: DirectoryListing
}

export interface SessionStateResponse {
  state: SessionState
}
