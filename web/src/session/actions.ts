import type {
  DirectoriesResponse,
  DirectoryListing,
  SessionState,
  SessionStateResponse,
  UsageReport,
} from '@piflow/protocol'
import { api, post, sessionUrl } from './api'
import { saveActiveSessionFile } from './persistence'
import { applyState } from './reducer'
import { ensureView, notify, store } from './store'

async function requestSession(path: string, body: unknown): Promise<SessionState> {
  const { state } = await post<SessionStateResponse>(path, body)
  applyState(state)
  store.activeKey = state.key
  saveActiveSessionFile(state.sessionFile)
  notify()
  return state
}

export function openSession(path: string): Promise<SessionState> {
  return requestSession('/api/sessions/open', { path })
}

export function newSession(): Promise<SessionState> {
  return requestSession('/api/sessions/new', store.cwd ? { cwd: store.cwd } : {})
}

export function newSessionIn(cwd: string): Promise<SessionState> {
  return requestSession('/api/sessions/new', { cwd })
}

export async function requestDirectories(path: string): Promise<DirectoryListing> {
  const { listing } = await api<DirectoriesResponse>(`/api/directories?path=${encodeURIComponent(path)}`)
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
  await post(sessionUrl(key, 'prompt'), { text })
  const view = ensureView(key)
  view.messages.push({ role: 'user', content: text, timestamp: Date.now() })
  view.tick++
  notify()
}

export function abort(key: string) {
  void post(sessionUrl(key, 'abort')).catch((error: unknown) => console.error('[piflow]', error))
}

export function setModel(key: string, provider: string, modelId: string) {
  void post(sessionUrl(key, 'model'), { provider, modelId }).catch((error: unknown) => console.error('[piflow]', error))
}

export function setThinking(key: string, level: string) {
  void post(sessionUrl(key, 'thinking'), { level }).catch((error: unknown) => console.error('[piflow]', error))
}

export function requestUsage(key: string, fresh = false) {
  void api<UsageReport>(`/api/usage?key=${encodeURIComponent(key)}${fresh ? '&fresh=1' : ''}`)
    .then((report) => {
      if (report.provider)
        store.usage[report.provider] = report
      notify()
    })
    .catch((error: unknown) => console.error('[piflow]', error))
}
