import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type {
  ApiOkResponse,
  CompactRequest,
  DirectoriesResponse,
  DirectoryListing,
  ExtensionChangeResponse,
  ExtensionSourceInfo,
  ExtensionsResponse,
  ExtensionUIResponseBody,
  ForkPoint,
  ForkPointsResponse,
  ForkSessionRequest,
  InstallExtensionRequest,
  ModelsResponse,
  NavigateSessionRequest,
  NewSessionRequest,
  OpenSessionRequest,
  ProjectTrustResponse,
  PromptRequest,
  ProviderAuthLoginRequest,
  ProviderAuthResponse,
  ProviderAuthStartResponse,
  ProviderInfo,
  ProvidersResponse,
  RemoveExtensionRequest,
  RenameSessionRequest,
  SessionState,
  SessionStateResponse,
  SessionTreeResponse,
  SetAutoCompactionRequest,
  SetModelRequest,
  SetThinkingRequest,
  TrustProjectRequest,
  UsageReport,
} from '@piflow/protocol'
import {
  API_EXTENSIONS_PATH,
  API_EXTENSIONS_UI_RESPONSE_PATH,
  API_MODELS_PATH,
  API_PROJECT_TRUST_PATH,
  API_PROVIDER_AUTH_PATH,
  API_PROVIDERS_PATH,
  buildDirectoriesPath,
  buildUsagePath,
  API_SESSIONS_NEW_PATH as newSessionPath,
  API_SESSIONS_OPEN_PATH as openSessionPath,
} from '@piflow/protocol'
import { api, post, sessionUrl } from './api'
import { clearActiveSessionFile, migrateDraft, saveActiveSessionFile } from './persistence'
import { applyState, clearSessionUnread } from './reducer'
import { ensureView, notify, store } from './store'

async function requestSession(path: string, body: OpenSessionRequest | NewSessionRequest): Promise<SessionState> {
  const draftKey = store.activeKey ?? `new:${store.cwd}`
  const request = post<SessionStateResponse>(path, body).then(({ state }) => {
    applyState(state)
    return state
  })
  const state = await Promise.race([
    request,
    new Promise<SessionState>((_, reject) => window.setTimeout(() => reject(new Error('操作超时，请重试')), 10_000)),
  ])
  store.activeKey = state.key
  migrateDraft(draftKey, state.key)
  clearSessionUnread(state.sessionFile ?? state.key)
  saveActiveSessionFile(state.sessionFile)
  notify()
  await Promise.all([requestModels(state.key), requestProjectTrust(state.cwd)])
  return state
}

export async function createBackgroundSession(cwd: string): Promise<SessionState> {
  const { state } = await post<SessionStateResponse>(newSessionPath, { cwd, persist: true } satisfies NewSessionRequest)
  applyState(state)
  return state
}

export function openSession(path: string): Promise<SessionState> {
  return requestSession(openSessionPath, { path })
}

export function newSession(): Promise<SessionState> {
  return requestSession(newSessionPath, store.cwd ? { cwd: store.cwd } : {})
}

export function newSessionIn(cwd: string): Promise<SessionState> {
  return requestSession(newSessionPath, { cwd })
}

export async function requestDirectories(path: string): Promise<DirectoryListing> {
  const { listing } = await api<DirectoriesResponse>(buildDirectoriesPath(path))
  return listing
}

export async function sendPrompt(text: string, images?: PromptRequest['images'], streamingBehavior?: PromptRequest['streamingBehavior']): Promise<void> {
  if (!store.connected)
    throw new Error('not connected')
  if (!store.activeKey)
    await newSession()
  const key = store.activeKey
  if (!key)
    return
  await post<ApiOkResponse>(sessionUrl(key, 'prompt'), { text, images, streamingBehavior } satisfies PromptRequest)
  const view = ensureView(key)
  const content = images?.length
    ? [...(text ? [{ type: 'text' as const, text }] : []), ...images]
    : text
  view.messages.push({ role: 'user', content, timestamp: Date.now() })
  view.tick++
  notify()
}

export async function abort(key: string): Promise<SessionState> {
  const { state } = await post<SessionStateResponse>(sessionUrl(key, 'abort'))
  applyState(state)
  return state
}

export async function clearQueue(key: string): Promise<SessionState> {
  const { state } = await post<SessionStateResponse>(sessionUrl(key, 'clear-queue'))
  applyState(state)
  return state
}

export async function setModel(key: string, provider: string, modelId: string): Promise<SessionState> {
  const { state } = await post<SessionStateResponse>(sessionUrl(key, 'model'), {
    provider,
    modelId,
  } satisfies SetModelRequest)
  applyState(state)
  return state
}

export async function setThinking(key: string, level: ThinkingLevel): Promise<SessionState> {
  const { state } = await post<SessionStateResponse>(sessionUrl(key, 'thinking'), { level } satisfies SetThinkingRequest)
  applyState(state)
  return state
}

export async function compact(key: string, instructions?: string): Promise<void> {
  await post<ApiOkResponse>(sessionUrl(key, 'compact'), { instructions } satisfies CompactRequest)
}

export async function abortCompaction(key: string): Promise<SessionState> {
  const { state } = await post<SessionStateResponse>(sessionUrl(key, 'abort-compaction'))
  applyState(state)
  return state
}

export async function setAutoCompaction(key: string, enabled: boolean): Promise<SessionState> {
  const { state } = await post<SessionStateResponse>(sessionUrl(key, 'auto-compaction'), { enabled } satisfies SetAutoCompactionRequest)
  applyState(state)
  return state
}

export function requestUsage(key: string, fresh = false) {
  void api<UsageReport>(buildUsagePath({ key, fresh }))
    .then((report) => {
      if (report.provider)
        store.usage[report.provider] = report
      notify()
    })
    .catch((error: unknown) => console.error('[piflow]', error))
}

export async function fetchExtensions(): Promise<ExtensionSourceInfo[]> {
  const cwd = activeCwd()
  const { extensions } = await api<ExtensionsResponse>(`${API_EXTENSIONS_PATH}?${new URLSearchParams({ cwd })}`)
  return extensions
}

export async function fetchProviders(): Promise<ProviderInfo[]> {
  const { providers } = await api<ProvidersResponse>(API_PROVIDERS_PATH)
  return providers
}

export function startProviderLogin(providerId: string, type: ProviderAuthLoginRequest['type']): Promise<ProviderAuthStartResponse> {
  return post<ProviderAuthStartResponse>(API_PROVIDER_AUTH_PATH, { providerId, type } satisfies ProviderAuthLoginRequest)
}

export function respondProviderAuth(operationId: string, promptId: string, value: string): Promise<ApiOkResponse> {
  return post<ApiOkResponse>(`${API_PROVIDER_AUTH_PATH}/${encodeURIComponent(operationId)}`, { operationId, promptId, value } satisfies ProviderAuthResponse)
}

export function cancelProviderAuth(operationId: string): Promise<ApiOkResponse> {
  return api<ApiOkResponse>(`${API_PROVIDER_AUTH_PATH}/${encodeURIComponent(operationId)}`, { method: 'DELETE' })
}

export function installExtension(source: string, scope: 'global' | 'project'): Promise<ExtensionChangeResponse> {
  return post<ExtensionChangeResponse>(API_EXTENSIONS_PATH, { source, scope, cwd: activeCwd() } satisfies InstallExtensionRequest)
}

export function removeExtension(source: string, scope: 'global' | 'project'): Promise<ExtensionChangeResponse> {
  return api<ExtensionChangeResponse>(API_EXTENSIONS_PATH, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source, scope, cwd: activeCwd() } satisfies RemoveExtensionRequest),
  })
}

export async function requestModels(key: string): Promise<void> {
  const { models } = await api<ModelsResponse>(`${API_MODELS_PATH}?${new URLSearchParams({ key })}`)
  if (store.activeKey === key) {
    store.models = models
    notify()
  }
}

export async function requestProjectTrust(cwd: string): Promise<void> {
  const { status } = await api<ProjectTrustResponse>(`${API_PROJECT_TRUST_PATH}?${new URLSearchParams({ cwd })}`)
  store.projectTrust[cwd] = status
  notify()
}

export async function trustProject(cwd: string): Promise<void> {
  const { status } = await post<ProjectTrustResponse>(API_PROJECT_TRUST_PATH, { cwd } satisfies TrustProjectRequest)
  store.projectTrust[cwd] = status
  const key = store.activeKey
  const path = key ? store.views[key]?.sessionFile : null
  if (path)
    await openSession(path)
  notify()
}

function activeCwd(): string {
  const key = store.activeKey
  return (key ? store.views[key]?.cwd : undefined) || store.cwd
}

/** Optimistically drop the dialog locally, then answer the suspended extension call. */
export async function answerExtensionRequest(response: ExtensionUIResponseBody): Promise<void> {
  const view = ensureView(response.session)
  view.extensionRequests = view.extensionRequests.filter(request => request.id !== response.id)
  view.tick++
  notify()
  await post<ApiOkResponse>(API_EXTENSIONS_UI_RESPONSE_PATH, response)
}

export function dismissExtensionNotice(id: string) {
  store.extensionNotices = store.extensionNotices.filter(notice => notice.request.id !== id)
  notify()
}

/** Empty name clears the display name. The server broadcasts the refreshed session list. */
export function renameSession(path: string, name: string): Promise<ApiOkResponse> {
  return post<ApiOkResponse>(sessionUrl(path, 'rename'), { name } satisfies RenameSessionRequest)
}

export async function fetchForkPoints(path: string): Promise<ForkPoint[]> {
  const { points } = await api<ForkPointsResponse>(sessionUrl(path, 'fork'))
  return points
}

/** Fork at the given entry and switch to the branched session. */
export async function forkSession(path: string, entryId: string): Promise<SessionState> {
  const { state } = await post<SessionStateResponse>(sessionUrl(path, 'fork'), { entryId } satisfies ForkSessionRequest)
  applyState(state)
  store.activeKey = state.key
  saveActiveSessionFile(state.sessionFile)
  notify()
  return state
}

export function fetchSessionTree(path: string): Promise<SessionTreeResponse> {
  return api<SessionTreeResponse>(sessionUrl(path, 'tree'))
}

export async function navigateSessionTree(path: string, targetId: string): Promise<SessionState> {
  const { state } = await post<SessionStateResponse>(sessionUrl(path, 'navigate'), { targetId } satisfies NavigateSessionRequest)
  applyState(state)
  notify()
  return state
}

export async function deleteSession(path: string): Promise<void> {
  await post<ApiOkResponse>(sessionUrl(path, 'delete'))
  if (store.activeKey === path) {
    store.activeKey = null
    clearActiveSessionFile()
  }
  delete store.views[path]
  notify()
}
