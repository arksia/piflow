import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { AuthEvent, AuthPrompt, AuthType, CredentialInfo } from '@earendil-works/pi-ai'
import type {
  ContextUsage,
  JsonAgentSessionEvent,
  ModelInfo,
  ModelRuntime,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
} from '@earendil-works/pi-coding-agent'

export {
  API_DIRECTORIES_PATH,
  API_EVENTS_PATH,
  API_EXTENSIONS_PATH,
  API_EXTENSIONS_UI_RESPONSE_PATH,
  API_FLOW_PATH,
  API_HELLO_PATH,
  API_MODELS_PATH,
  API_PROJECT_TRUST_PATH,
  API_PROVIDER_AUTH_PATH,
  API_PROVIDERS_PATH,
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
  MAX_PROMPT_IMAGE_BYTES,
  MAX_PROMPT_IMAGES,
  parseSessionActionPath,
  SESSION_ACTIONS,
} from './http'
export type {
  ApiOkResponse,
  CompactRequest,
  ForkPoint,
  ForkPointsResponse,
  ForkSessionRequest,
  NavigateSessionRequest,
  NewSessionRequest,
  OpenSessionRequest,
  PromptRequest,
  RenameSessionRequest,
  SessionAction,
  SetAutoCompactionRequest,
  SetModelRequest,
  SetThinkingRequest,
  TrustProjectRequest,
} from './http'
export type { ImageContent } from '@earendil-works/pi-ai'
export type { AuthEvent, AuthPrompt, AuthType } from '@earendil-works/pi-ai'

/** POST body for the extension-UI response route: the official RPC frame plus the target session key. */
export type ExtensionUIResponseBody = { session: string } & RpcExtensionUIResponse

export interface SessionInfoLite {
  path: string
  id: string
  cwd: string
  name: string | null
  /** Path of the session this one was forked from, if any. */
  parentSession: string | null
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

export type SessionStatus = 'idle' | 'running' | 'failed'

export interface SessionStatusRecord {
  key: string
  sessionFile: string | null
  status: SessionStatus
  /**
   * Independent attention axis: set while a select/confirm/input dialog is
   * awaiting a user answer (ISO time of the first pending request), null
   * otherwise. Never encoded in `status`, which stays a pure run state.
   */
  needsInputAt: string | null
  updatedAt: string
}

export interface ExtensionSourceInfo {
  source: string
  scope: 'user' | 'project'
  filtered: boolean
  installedPath?: string
}

export interface ExtensionsResponse {
  extensions: ExtensionSourceInfo[]
}

export interface InstallExtensionRequest {
  source: string
  cwd: string
  scope: 'global' | 'project'
}

export interface RemoveExtensionRequest {
  source: string
  cwd: string
  scope: 'global' | 'project'
}

export interface ExtensionChangeResponse {
  ok: true
  reloaded: number
}

export interface ProjectTrustStatus {
  cwd: string
  requiresTrust: boolean
  trusted: boolean
}

export interface ProjectTrustResponse {
  status: ProjectTrustStatus
}

export interface SessionState {
  key: string
  cwd: string
  sessionId?: string
  sessionFile?: string | null
  messages: AgentMessage[]
  isStreaming: boolean
  isCompacting: boolean
  /** Whether pi auto-compaction is enabled (persisted in pi settings). */
  autoCompactionEnabled: boolean
  model: ModelInfo | null
  thinkingLevel: ThinkingLevel | null
  thinkingLevels: ThinkingLevel[]
  context: ContextUsage | null
  queue: { steering: string[], followUp: string[] }
  extensionRequests: RpcExtensionUIRequest[]
  error: string | null
}

export type ServerMessage
  = | { type: 'hello', cwd: string }
    | { type: 'sessions', sessions: SessionInfoLite[] }
    | { type: 'models', models: ModelInfo[] }
    | { type: 'state', state: SessionState }
    | { type: 'event', session: string, event: JsonAgentSessionEvent, context?: ContextUsage | null }
    | { type: 'status_snapshot', statuses: SessionStatusRecord[] }
    | { type: 'status_delta', status: SessionStatusRecord }
    | { type: 'provider_auth', operationId: string, event: ProviderAuthEvent }
    | ({ session: string } & RpcExtensionUIRequest)
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

export interface ProviderInfo {
  id: string
  name: string
  authTypes: AuthType[]
  oauthName?: string
  credentialType?: CredentialInfo['type']
  configured: boolean
  source?: ReturnType<ModelRuntime['getProviderAuthStatus']>['source']
  label?: string
  modelCount: number
}

export interface ProvidersResponse {
  providers: ProviderInfo[]
}

export interface ProviderAuthLoginRequest {
  providerId: string
  type: AuthType
}

export interface ProviderAuthStartResponse {
  operationId: string
  prompt?: ProviderAuthPrompt
}

export interface ProviderAuthPrompt {
  id: string
  prompt:
    | Omit<Extract<AuthPrompt, { type: 'text' }>, 'signal'>
    | Omit<Extract<AuthPrompt, { type: 'secret' }>, 'signal'>
    | Omit<Extract<AuthPrompt, { type: 'select' }>, 'signal'>
    | Omit<Extract<AuthPrompt, { type: 'manual_code' }>, 'signal'>
}

export type ProviderAuthEvent
  = { type: 'prompt', prompt: ProviderAuthPrompt }
    | ({ type: 'info' | 'auth_url' | 'device_code' | 'progress' } & Omit<AuthEvent, 'type'>)
    | { type: 'completed' }
    | { type: 'failed', message: string }

export interface ProviderAuthResponse {
  operationId: string
  promptId: string
  value: string
}

export interface DirectoriesResponse {
  listing: DirectoryListing
}

export interface SessionStateResponse {
  state: SessionState
}

export interface SessionTreeResponse {
  tree: import('@earendil-works/pi-coding-agent').SessionTreeNode[]
  leafId: string | null
}
