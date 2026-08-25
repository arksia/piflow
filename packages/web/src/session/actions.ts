import type {
  ApiOkResponse,
  DirectoriesResponse,
  DirectoryListing,
  ExtensionChangeResponse,
  ExtensionSourceInfo,
  ExtensionsResponse,
  ExtensionUIResponse,
  InstallExtensionRequest,
  NewSessionRequest,
  OpenSessionRequest,
  PromptRequest,
  RemoveExtensionRequest,
  SessionState,
  SessionStateResponse,
  SetModelRequest,
  SetThinkingRequest,
  UsageReport,
} from '@piflow/protocol'
import {
  API_EXTENSIONS_PATH,
  API_EXTENSIONS_UI_RESPONSE_PATH,
  buildDirectoriesPath,
  buildUsagePath,
  API_SESSIONS_NEW_PATH as newSessionPath,
  API_SESSIONS_OPEN_PATH as openSessionPath,
} from '@piflow/protocol'
import { api, post, sessionUrl } from './api'
import { saveActiveSessionFile } from './persistence'
import { applyState } from './reducer'
import { ensureView, notify, store } from './store'

async function requestSession(path: string, body: OpenSessionRequest | NewSessionRequest): Promise<SessionState> {
  const { state } = await post<SessionStateResponse>(path, body)
  applyState(state)
  store.activeKey = state.key
  saveActiveSessionFile(state.sessionFile)
  notify()
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

export async function sendPrompt(text: string): Promise<void> {
  if (!store.connected)
    throw new Error('not connected')
  if (!store.activeKey)
    await newSession()
  const key = store.activeKey
  if (!key)
    return
  await post<ApiOkResponse>(sessionUrl(key, 'prompt'), { text } satisfies PromptRequest)
  const view = ensureView(key)
  view.messages.push({ role: 'user', content: text, timestamp: Date.now() })
  view.tick++
  notify()
}

export function abort(key: string) {
  void post<ApiOkResponse>(sessionUrl(key, 'abort')).catch((error: unknown) => console.error('[piflow]', error))
}

export function setModel(key: string, provider: string, modelId: string) {
  void post<ApiOkResponse>(sessionUrl(key, 'model'), {
    provider,
    modelId,
  } satisfies SetModelRequest).catch((error: unknown) => console.error('[piflow]', error))
}

export function setThinking(key: string, level: string) {
  void post<ApiOkResponse>(sessionUrl(key, 'thinking'), { level } satisfies SetThinkingRequest).catch((error: unknown) => console.error('[piflow]', error))
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
  const { extensions } = await api<ExtensionsResponse>(API_EXTENSIONS_PATH)
  return extensions
}

export function installExtension(source: string): Promise<ExtensionChangeResponse> {
  return post<ExtensionChangeResponse>(API_EXTENSIONS_PATH, { source } satisfies InstallExtensionRequest)
}

export function removeExtension(source: string): Promise<ExtensionChangeResponse> {
  return api<ExtensionChangeResponse>(API_EXTENSIONS_PATH, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source } satisfies RemoveExtensionRequest),
  })
}

/** Optimistically drop the dialog locally, then answer the suspended extension call. */
export async function answerExtensionRequest(response: ExtensionUIResponse): Promise<void> {
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
