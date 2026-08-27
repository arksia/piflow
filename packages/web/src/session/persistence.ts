const ACTIVE_KEY = 'piflow.active'

export function saveActiveSessionFile(sessionFile?: string | null) {
  if (sessionFile)
    localStorage.setItem(ACTIVE_KEY, JSON.stringify({ path: sessionFile }))
}

export function clearActiveSessionFile() {
  localStorage.removeItem(ACTIVE_KEY)
}

export function readSavedActivePath(): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? 'null') as { path?: unknown } | null
    return typeof saved?.path === 'string' ? saved.path : null
  }
  catch {
    return null
  }
}

const COLLAPSED_KEY = 'piflow.collapsed-sessions'

export function readCollapsedSessions(): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(saved) ? saved.filter((path): path is string => typeof path === 'string') : [])
  }
  catch {
    return new Set()
  }
}

export function saveCollapsedSessions(collapsed: ReadonlySet<string>) {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]))
}
