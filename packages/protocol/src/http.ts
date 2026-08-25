export const AUTH_PATH = '/auth'

export const API_EVENTS_PATH = '/api/events'
export const API_HELLO_PATH = '/api/hello'
export const API_SESSIONS_PATH = '/api/sessions'
export const API_MODELS_PATH = '/api/models'
export const API_DIRECTORIES_PATH = '/api/directories'
export const API_USAGE_PATH = '/api/usage'
export const API_FLOW_PATH = '/api/flow'
export const API_SESSIONS_OPEN_PATH = '/api/sessions/open'
export const API_SESSIONS_NEW_PATH = '/api/sessions/new'

export const SESSION_ACTIONS = ['prompt', 'abort', 'model', 'thinking'] as const

export type SessionAction = (typeof SESSION_ACTIONS)[number]

export interface OpenSessionRequest {
  path: string
}

export interface NewSessionRequest {
  cwd?: string
  persist?: boolean
}

export interface PromptRequest {
  text: string
}

export interface SetModelRequest {
  provider: string
  modelId: string
}

export interface SetThinkingRequest {
  level: string
}

export interface ApiOkResponse {
  ok: true
}

export function buildAuthPath(token?: string): string {
  if (!token)
    return AUTH_PATH
  const search = new URLSearchParams({ token })
  return `${AUTH_PATH}?${search.toString()}`
}

export function buildDirectoriesPath(path: string): string {
  return buildPathWithSearch(API_DIRECTORIES_PATH, { path })
}

export function buildUsagePath(options: { key?: string, provider?: string, fresh?: boolean } = {}): string {
  const { key, provider, fresh } = options
  return buildPathWithSearch(API_USAGE_PATH, {
    key,
    provider,
    fresh: fresh ? '1' : undefined,
  })
}

export function buildFlowPath(projectPath: string): string {
  return buildPathWithSearch(API_FLOW_PATH, { projectPath })
}

export function buildSessionActionPath(key: string, action: SessionAction): string {
  return `${API_SESSIONS_PATH}/${encodeURIComponent(key)}/${action}`
}

export function parseSessionActionPath(path: string): { key: string, action: SessionAction } | null {
  const match = path.match(/^\/api\/sessions\/([^/]+)\/([^/]+)$/)
  if (!match)
    return null
  const action = match[2]
  if (!action || !isSessionAction(action))
    return null
  return { key: decodeURIComponent(match[1]!), action }
}

function buildPathWithSearch(pathname: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined)
      search.set(key, value)
  }
  const query = search.toString()
  return query ? `${pathname}?${query}` : pathname
}

function isSessionAction(value: string): value is SessionAction {
  return (SESSION_ACTIONS as readonly string[]).includes(value)
}
