import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { AuthEvent, AuthPrompt, AuthType, CredentialInfo } from '@earendil-works/pi-ai'
import type {
  AgentSessionRuntimeDiagnostic,
  ContextUsage,
  JsonAgentSessionEvent,
  ModelInfo,
  ModelRuntime,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  SessionStats,
} from '@earendil-works/pi-coding-agent'
import type { AgentConfiguration, FlowMembership, SubagentRun } from './agents'

export { InvalidAgentConfiguration, parseAgentConfiguration, parseFlowMemberships } from './agents'
export type { AgentConfiguration, FlowMembership, SubagentRun } from './agents'

export {
  LEGACY_MODULES_FILE,
  parseLegacyModules,
  parseProjectCanvas,
  PROJECT_CANVAS_FILE,
  PROJECT_CANVAS_VERSION,
  serializeProjectCanvas,
  UnsupportedProjectCanvasVersion,
} from './canvas'
export type {
  CanvasLink,
  CanvasNode,
  LegacyModules,
  ProjectCanvas,
  ProjectCanvasDocument,
} from './canvas'
export {
  conductorDraftReady,
  mergeConductorDraft,
  parseConductorDraft,
  stripConductorFences,
} from './conductor'
export type {
  ConductorDraft,
  ConductorDraftLink,
  ConductorDraftModule,
} from './conductor'
export {
  API_COMPOSER_PATH,
  API_DIRECTORIES_PATH,
  API_EVENTS_PATH,
  API_EXTENSIONS_PATH,
  API_EXTENSIONS_UI_RESPONSE_PATH,
  API_FLOW_ACCEPT_PATH,
  API_FLOW_PATH,
  API_GIT_PATH,
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
  buildComposerCommandsPath,
  buildComposerPathsPath,
  buildDirectoriesPath,
  buildFlowPath,
  buildGitPath,
  buildSessionActionPath,
  buildUsagePath,
  MAX_PROMPT_IMAGE_BYTES,
  MAX_PROMPT_IMAGES,
  parseSessionActionPath,
  SESSION_ACTIONS,
} from './http'
export type {
  AcceptConductorRequest,
  ApiOkResponse,
  CompactRequest,
  ComposerCommandHit,
  ComposerCommandsResponse,
  ComposerPathHit,
  ComposerPathsResponse,
  ForkPoint,
  ForkPointsResponse,
  ForkSessionRequest,
  GitBranchesResponse,
  GitCheckoutRequest,
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
export type { SessionStats } from '@earendil-works/pi-coding-agent'

/** POST body for the extension-UI response route: the official RPC frame plus the target session key. */
export type ExtensionUIResponseBody = { session: string } & RpcExtensionUIResponse

export interface SessionInfoLite {
  path: string
  id: string
  cwd: string
  name: string | null
  /** This session is the project's Conductor. */
  conductor?: boolean
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

export interface FlowNode extends AgentConfiguration {
  id: string
  sessionPath: string
  name: string
  goal: string
  /** Standing text injected for this node. The committed copy is `.piflow/canvas.json`. */
  brief?: string
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

export type FlowDeliveryStatus = 'queued' | 'delivered' | 'replied' | 'failed'

export interface FlowMessageRecord {
  id: string
  edgeId: string
  source: string
  target: string
  /** Full text, kept so a waiting delivery can be handed over after restart. */
  body: string
  preview: string
  sentAt: string
  status: FlowDeliveryStatus
  /** True once the target run for this delivery has started. */
  read: boolean
  reply?: string
  /** True after the one reminder to reply. */
  reminded: boolean
}

export interface FlowTopology {
  memberships?: FlowMembership[]
  nodes: FlowNode[]
  edges: FlowEdge[]
  viewport: FlowViewport
}

export interface FlowDocument extends FlowTopology {
  runs?: SubagentRun[]
  version: 1
  projectPath: string
  messages: FlowMessageRecord[]
  /** Local Conductor session. Absent from the committed canvas. */
  conductorPath?: string
  updatedAt: string
}

export interface FlowDocumentResponse {
  document: FlowDocument
  /** False only before this project has ever saved a canvas, including an empty one. */
  stored: boolean
}

export interface ReplaceFlowRequest {
  projectPath: string
  topology: FlowTopology
  /** Set when this save may change nodes, Briefs, links, or positions. A viewport save omits it. */
  commitGraph?: boolean
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
  modelScope?: Array<{ model: ModelInfo, thinkingLevel?: ThinkingLevel }>
  modelDiagnostics?: Array<Pick<AgentSessionRuntimeDiagnostic, 'type' | 'message'>>
  stats?: SessionStats
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

export interface ProviderCheckResponse {
  configured: boolean
  type?: AuthType
  source?: string
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
    | Extract<AuthEvent, { type: 'info' }>
    | Extract<AuthEvent, { type: 'auth_url' }>
    | Extract<AuthEvent, { type: 'device_code' }>
    | Extract<AuthEvent, { type: 'progress' }>
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
