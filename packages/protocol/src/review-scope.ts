import type { ReviewDetail } from './reviews.ts'

/** Shared scope semantics for the reader and project attention; routes never affect counts. */
export function reviewScope(detail: Pick<ReviewDetail, 'targets' | 'decisions' | 'exclusions' | 'gaps'>) {
  const excluded = new Set(detail.exclusions?.map(item => item.hunkId))
  const targets = [...new Map(detail.targets.map(target => [target.id, target])).values()]
    .filter(target => !target.hunkIds.length || !target.hunkIds.every(id => excluded.has(id)))
  const decisions = new Map(detail.decisions.map(item => [item.targetId, item.state]))
  const unread = targets.filter(target => (decisions.get(target.id) ?? 'unread') === 'unread')
  const changesRequested = targets.filter(target => decisions.get(target.id) === 'changes-requested')
  const seen = targets.filter(target => decisions.get(target.id) === 'seen')
  const gaps = detail.gaps.filter(gap => gap.source === 'host' && gap.kind !== 'document-missing')
  return { targets, unread, changesRequested, seen, gaps }
}
