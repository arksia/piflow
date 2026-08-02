import type {
  ModelsResponse,
  ServerMessage,
  SessionsResponse,
} from '@piflow/protocol'
import { openSession } from './actions'
import { api } from './api'
import { route } from './reducer'
import { notify, store } from './store'

function restoreSession(path: string) {
  void openSession(path).catch(() => {})
}

async function resync() {
  try {
    const [sessions, models] = await Promise.all([
      api<SessionsResponse>('/api/sessions'),
      api<ModelsResponse>('/api/models'),
    ])
    store.models = models.models
    route({ type: 'sessions', sessions: sessions.sessions }, restoreSession)
    const key = store.activeKey
    if (key && !key.startsWith('new:'))
      await openSession(key)
  }
  catch (error) {
    console.error('[piflow]', error)
  }
}

async function connect() {
  try {
    const url = new URL(location.href)
    const token = url.searchParams.get('token')
    const authUrl = token ? `/auth?token=${encodeURIComponent(token)}` : '/auth'
    const response = await fetch(authUrl, { cache: 'no-store' })
    if (!response.ok)
      throw new Error(`authentication failed: ${response.status}`)
    if (token) {
      url.searchParams.delete('token')
      history.replaceState(null, '', url)
    }
  }
  catch (error) {
    console.error('[piflow]', error)
    setTimeout(connect, 1500)
    return
  }

  const source = new EventSource('/api/events')

  source.onopen = () => {
    store.connected = true
    notify()
    void resync()
  }

  source.onmessage = (event) => {
    route(JSON.parse(String(event.data)) as ServerMessage, restoreSession)
  }

  source.onerror = () => {
    if (store.connected) {
      store.connected = false
      notify()
    }
  }
}

export function initClient() {
  void connect()
}
