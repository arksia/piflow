import type { AgentMessage, AgentToolResult, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type {
  ContextUsage,
  ModelInfo,
  RpcExtensionUIRequest,
} from '@earendil-works/pi-coding-agent'
import type {
  ProjectTrustStatus,
  SessionInfoLite,
  SessionStatusRecord,
  UsageReport,
} from '@piflow/protocol'

export interface ToolState {
  running?: boolean
  args?: unknown
  partial?: AgentToolResult<Record<string, unknown>>
  result?: AgentToolResult<Record<string, unknown>>
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
  model: ModelInfo | null
  thinkingLevel: ThinkingLevel | null
  thinkingLevels: ThinkingLevel[]
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
  cwd: string
  sessions: SessionInfoLite[]
  models: ModelInfo[]
  usage: Record<string, UsageReport>
  activeKey: string | null
  views: Record<string, SessionView>
  statuses: Record<string, SessionStatusRecord>
  extensionNotices: ExtensionNotice[]
  projectTrust: Record<string, ProjectTrustStatus>
  sidebarOpen: boolean
}
