const ACTIVE_KEY = 'piflow.active'

export interface DraftImage {
  id: string
  type: 'image'
  data: string
  mimeType: string
  previewUrl: string
}

interface Draft {
  text: string
  images: DraftImage[]
}

const drafts = new Map<string, Draft>()

export function readDraft(key: string | null): Draft {
  const draft = key ? drafts.get(key) : undefined
  return draft ? { text: draft.text, images: [...draft.images] } : { text: '', images: [] }
}

export function saveDraftText(key: string | null, text: string) {
  if (!key)
    return
  const images = drafts.get(key)?.images ?? []
  if (text || images.length)
    drafts.set(key, { text, images })
  else
    drafts.delete(key)
}

export function saveDraftImages(key: string | null, images: DraftImage[]) {
  if (!key)
    return
  const text = drafts.get(key)?.text ?? ''
  if (text || images.length)
    drafts.set(key, { text, images: [...images] })
  else
    drafts.delete(key)
}

export function clearDraft(key: string | null) {
  if (key)
    drafts.delete(key)
}

export function migrateDraft(from: string, to: string) {
  const draft = drafts.get(from)
  if (!draft)
    return
  drafts.set(to, draft)
  drafts.delete(from)
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
