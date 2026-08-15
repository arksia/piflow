import type {
  ChatMessage,
  ModelInfo,
  SessionContext,
  SessionInfoLite,
  SessionStatusRecord,
  ToolExecutionPayload,
  UsageReport,
} from '@piflow/protocol'

export interface ToolState {
  running?: boolean
  args?: unknown
  partial?: ToolExecutionPayload
  result?: ToolExecutionPayload
  isError?: boolean
}

export interface SessionView {
  key: string
  sessionFile: string | null
  messages: ChatMessage[]
  live: ChatMessage | null
  isStreaming: boolean
  isCompacting: boolean
  model: ModelInfo | null
  thinkingLevel: string | null
  thinkingLevels: string[]
  context: SessionContext | null
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
  statuses: Record<string, SessionStatusRecord>
  sidebarOpen: boolean
}
