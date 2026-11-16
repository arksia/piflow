import { openSession } from '../../session/actions'
import { readDraft, saveDraftText } from '../../session/persistence'

export async function draftToSession(path: string, text: string) {
  const session = await openSession(path)
  const existing = readDraft(session.key).text
  const next = existing.trim() ? `${existing}\n\n${text}` : text
  saveDraftText(session.key, next)
  window.dispatchEvent(new CustomEvent('piflow:set-editor-text', { detail: { session: session.key, text: next } }))
}
