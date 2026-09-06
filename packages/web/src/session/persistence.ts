const ACTIVE_KEY = 'piflow.active'
const DRAFT_PREFIX = 'piflow.draft:'

export function readDraft(key: string | null): string {
  return key ? localStorage.getItem(`${DRAFT_PREFIX}${key}`) ?? '' : ''
}

export function saveDraft(key: string | null, text: string) {
  if (!key)
    return
  const storageKey = `${DRAFT_PREFIX}${key}`
  if (text)
    localStorage.setItem(storageKey, text)
  else
    localStorage.removeItem(storageKey)
}

export function migrateDraft(from: string, to: string) {
  const draft = readDraft(from)
  if (draft) {
    saveDraft(to, draft)
    saveDraft(from, '')
  }
}

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

const UNREAD_KEY = 'piflow.unread-sessions'

export function readUnreadSessions(): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(UNREAD_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(saved) ? saved.filter((path): path is string => typeof path === 'string') : [])
  }
  catch {
    return new Set()
  }
}

export function saveUnreadSessions(unread: ReadonlySet<string>) {
  if (unread.size)
    localStorage.setItem(UNREAD_KEY, JSON.stringify([...unread]))
  else
    localStorage.removeItem(UNREAD_KEY)
}

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
