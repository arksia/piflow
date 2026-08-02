const ACTIVE_KEY = 'piflow.active'

export function saveActiveSessionFile(sessionFile?: string | null) {
  if (sessionFile)
    localStorage.setItem(ACTIVE_KEY, JSON.stringify({ path: sessionFile }))
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
