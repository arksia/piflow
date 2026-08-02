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
