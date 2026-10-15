import type { AgentMessage, AgentToolResult, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type {
  ContextUsage,
  ModelInfo,
  RpcExtensionUIRequest,
} from '@earendil-works/pi-coding-agent'
import type {
  ProjectTrustStatus,
  SessionInfoLite,
  SessionStats,
  SessionStatusRecord,
  UsageReport,
} from '@piflow/protocol'

export interface ToolState {
  running?: boolean
  name?: string
  args?: unknown
  /** Set when another tool, such as a codemode script, made this call. */
  parentId?: string
  durationMs?: number
  partial?: AgentToolResult
  result?: AgentToolResult
  isError?: boolean
}

export interface SessionView {
  key: string
  cwd: string
  sessionFile: string | null
  messages: AgentMessage[]
  live: AgentMessage | null
  isStreaming: boolean
  isCompacting: boolean
  autoCompactionEnabled: boolean
  compactionNotice: { status: 'success', tokensBefore: number, tokensAfter?: number } | { status: 'aborted' | 'error', message?: string } | null
  model: ModelInfo | null
  thinkingLevel: ThinkingLevel | null
  thinkingLevels: ThinkingLevel[]
  modelScope: Array<{ model: ModelInfo, thinkingLevel?: ThinkingLevel }>
  modelDiagnostics: Array<{ type: 'info' | 'warning' | 'error', message: string }>
  stats: SessionStats | null
  context: ContextUsage | null
  toolResults: Record<string, ToolState>
  queue: { steering: readonly string[], followUp: readonly string[] }
  extensionRequests: RpcExtensionUIRequest[]
  error: string | null
  tick: number
}

export interface ExtensionNotice {
  session: string
  request: Extract<RpcExtensionUIRequest, { method: 'notify' }>
}

export interface StoreState {
  connected: boolean
  connectionState: 'connecting' | 'connected' | 'reconnecting'
  cwd: string
  sessions: SessionInfoLite[]
  models: ModelInfo[]
  usage: Record<string, UsageReport>
  activeKey: string | null
  views: Record<string, SessionView>
  statuses: Record<string, SessionStatusRecord>
  unreadSessions: ReadonlySet<string>
  seenFailures: Readonly<Record<string, string>>
  extensionNotices: ExtensionNotice[]
  projectTrust: Record<string, ProjectTrustStatus>
  sidebarOpen: boolean
}
