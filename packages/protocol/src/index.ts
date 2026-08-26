export {
  API_DIRECTORIES_PATH,
  API_EVENTS_PATH,
  API_EXTENSIONS_PATH,
  API_EXTENSIONS_UI_RESPONSE_PATH,
  API_FLOW_PATH,
  API_HELLO_PATH,
  API_MODELS_PATH,
  API_SESSIONS_NEW_PATH,
  API_SESSIONS_OPEN_PATH,
  API_SESSIONS_PATH,
  API_USAGE_PATH,
  AUTH_PATH,
  buildAuthPath,
  buildDirectoriesPath,
  buildFlowPath,
  buildSessionActionPath,
  buildUsagePath,
  parseSessionActionPath,
  SESSION_ACTIONS,
} from './http'
export type {
  ApiOkResponse,
  ForkPoint,
  ForkPointsResponse,
  ForkSessionRequest,
  NewSessionRequest,
  OpenSessionRequest,
  PromptRequest,
  RenameSessionRequest,
  SessionAction,
  SetModelRequest,
  SetThinkingRequest,
} from './http'

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

export interface FlowPosition {
  x: number
  y: number
}

export interface FlowViewport extends FlowPosition {
  zoom: number
}

export interface FlowNode {
  id: string
  sessionPath: string
  name: string
  goal: string
  position: FlowPosition
  createdAt: string
  updatedAt: string
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  createdAt: string
}

export interface FlowMessageRecord {
  id: string
  edgeId: string
  source: string
  target: string
  chainId: string
  hop: number
  preview: string
  sentAt: string
}

export interface FlowTopology {
  nodes: FlowNode[]
  edges: FlowEdge[]
  viewport: FlowViewport
}

export interface FlowDocument extends FlowTopology {
  version: 1
  projectPath: string
  messages: FlowMessageRecord[]
  updatedAt: string
}

export interface FlowDocumentResponse {
  document: FlowDocument
}

export interface ReplaceFlowRequest {
  projectPath: string
  topology: FlowTopology
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

export type SessionStatus = 'idle' | 'running' | 'failed'

export interface SessionStatusRecord {
  key: string
  sessionFile: string | null
  status: SessionStatus
  updatedAt: string
}

export interface ToolContentPart {
  type: string
  text?: string
}

export interface ToolExecutionPayload {
  content?: ToolContentPart[]
  details?: Record<string, unknown>
}

export interface ExtensionSourceInfo {
  source: string
  scope: 'user' | 'project'
  filtered: boolean
  installedPath?: string
}

export type ExtensionUIMethod = 'select' | 'confirm' | 'input' | 'notify'

export interface ExtensionUIRequest {
  id: string
  method: ExtensionUIMethod
  title?: string
  message?: string
  options?: string[]
  placeholder?: string
  notifyType?: 'info' | 'warning' | 'error'
}

export interface ExtensionUIResponse {
  id: string
  session: string
  cancelled?: boolean
  value?: string
  confirmed?: boolean
}

export interface ExtensionsResponse {
  extensions: ExtensionSourceInfo[]
}

export interface InstallExtensionRequest {
  source: string
  local?: boolean
}

export interface RemoveExtensionRequest {
  source: string
  local?: boolean
}

export interface ExtensionChangeResponse {
  ok: true
  reloaded: number
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
  extensionRequests: ExtensionUIRequest[]
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
    | { type: 'status_snapshot', statuses: SessionStatusRecord[] }
    | { type: 'status_delta', status: SessionStatusRecord }
    | { type: 'extension_ui_request', session: string, request: ExtensionUIRequest }
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
