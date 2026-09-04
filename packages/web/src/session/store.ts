import type { SessionView, StoreState } from './state'

const listeners = new Set<() => void>()
let version = 0
let flushFrame = 0

export function notify() {
  version++
  if (flushFrame)
    return
  const flush = () => {
    flushFrame = 0
    for (const listener of listeners)
      listener()
  }
  // Hidden tabs never fire rAF; fall back to a timer so SSE-driven updates
  // are not dropped while the page is backgrounded. window.setTimeout keeps the
  // numeric DOM handle even when @types/node is loaded by test files.
  flushFrame = document.hidden ? window.setTimeout(flush, 100) : requestAnimationFrame(flush)
}

export const store: StoreState = {
  connected: false,
  cwd: '',
  sessions: [],
  models: [],
  usage: {},
  activeKey: null,
  views: {},
  statuses: {},
  extensionNotices: [],
  projectTrust: {},
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
    cwd: '',
    sessionFile: null,
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
    extensionRequests: [],
    error: null,
    tick: 0,
  })
}
