import type { SessionView, StoreState } from './state'

const listeners = new Set<() => void>()
let version = 0
let flushFrame = 0

export function notify() {
  version++
  if (flushFrame)
    return
  flushFrame = requestAnimationFrame(() => {
    flushFrame = 0
    for (const listener of listeners)
      listener()
  })
}

export const store: StoreState = {
  connected: false,
  cwd: '',
  sessions: [],
  models: [],
  usage: {},
  activeKey: null,
  views: {},
  sidebarOpen: false,
}

export function subscribeStore(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getStoreVersion(): number {
  return version
}

export function setSidebarOpen(open: boolean) {
  store.sidebarOpen = open
  notify()
}

export function ensureView(key: string): SessionView {
  return (store.views[key] ??= {
    key,
    messages: [],
    live: null,
    isStreaming: false,
    isCompacting: false,
    model: null,
    thinkingLevel: null,
    thinkingLevels: [],
    context: null,
    toolResults: {},
    queue: { steering: [], followUp: [] },
    error: null,
    tick: 0,
  })
}
