import type {
  ServerMessage,
  SessionsResponse,
} from '@piflow/protocol'
import {
  buildAuthPath,
  API_EVENTS_PATH as eventsPath,
  API_SESSIONS_PATH as sessionsPath,
} from '@piflow/protocol'
import { setRunsConnected } from '../features/runs/store'
import { openSession } from './actions'
import { api } from './api'
import { route } from './reducer'
import { notify, store } from './store'

function restoreSession(path: string) {
  void openSession(path).catch(() => {})
}

async function resync() {
  try {
    const sessions = await api<SessionsResponse>(sessionsPath)
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
    const authUrl = buildAuthPath(token ?? undefined)
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

  const source = new EventSource(eventsPath)

  source.onopen = () => {
    markConnected()
    void resync()
  }

  source.onmessage = (event) => {
    route(JSON.parse(String(event.data)) as ServerMessage, restoreSession)
  }

  source.onerror = () => {
    markReconnecting()
    // A local restart rotates the cookie token; reauthenticate before retrying SSE.
    source.close()
    setTimeout(connect, 1500)
  }
}

export function markConnected() {
  setRunsConnected(true)
  store.connected = true
  store.connectionState = 'connected'
  notify()
}

export function markReconnecting() {
  setRunsConnected(false)
  store.connected = false
  store.connectionState = 'reconnecting'
  notify()
}

export function initClient() {
  void connect()
}
