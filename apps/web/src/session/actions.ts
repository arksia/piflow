import type {
  ApiOkResponse,
  DirectoriesResponse,
  DirectoryListing,
  NewSessionRequest,
  OpenSessionRequest,
  PromptRequest,
  SessionState,
  SessionStateResponse,
  SetModelRequest,
  SetThinkingRequest,
  UsageReport,
} from '@piflow/protocol'
import {
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
