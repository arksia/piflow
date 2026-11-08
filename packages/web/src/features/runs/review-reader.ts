import type { ReviewDetail, ReviewMessage } from '@piflow/protocol'
import { buildReviewsPath, buildRunsPath } from '@piflow/protocol'
import { api } from '../../session/api'

const subscriptions = new Set<(event: ReviewMessage) => void>()
export function receiveReview(event: ReviewMessage) {
  for (const listener of subscriptions) listener(event)
}
export interface ReviewWindow {
  detail: ReviewDetail | null
  reviewId: string | null
  reason: string | null
  loading: boolean
  error: string | null
}
/** Per-open reader: revisions, notifications and late HTTP responses share one scope. */
export function createReviewReader(projectPath: string, runId: string, request = api) {
  let state: ReviewWindow = { detail: null, reviewId: null, reason: null, loading: false, error: null }
  const listeners = new Set<() => void>()
  let revisionId: string | undefined
  let generation = 0
  let opened = false
  let busy = false
  let pending = false
  let minimumVersion = 0
  function update(value: Partial<ReviewWindow>) {
    state = { ...state, ...value }
    for (const listener of listeners) listener()
  }
  async function refresh() {
    pending = true
    if (!opened || busy)
      return
    busy = true
    update({ loading: true })
    let current = generation
    try {
      while (pending) {
        if (!opened)
          break
        pending = false
        current = generation
        const selected = revisionId
        const observed = minimumVersion
        const link = await request<{ reviewId: string | null, reason: string | null }>(buildRunsPath(projectPath, `/${encodeURIComponent(runId)}/review`))
        if (!opened || current !== generation)
          continue
        if (!link.reviewId) {
          update({ reviewId: null, reason: link.reason, detail: null, error: null })
          continue
        }
        if (state.reviewId && state.reviewId !== link.reviewId)
          minimumVersion = 0
        const value = await request<ReviewDetail>(buildReviewsPath(projectPath, `/${encodeURIComponent(link.reviewId)}`, { revisionId: selected }))
        if (!opened || current !== generation)
          continue
        if (value.review.projectPath !== projectPath || value.review.id !== link.reviewId || (selected && value.revision.id !== selected))
          throw new Error('审查记录身份或修订不匹配。')
        if (value.review.version < minimumVersion) {
          if (observed < minimumVersion) {
            pending = true
            continue
          }
          throw new Error('审查版本落后，请重新同步。')
        }
        const previous = state.detail
        if (previous && previous.review.id === value.review.id && previous.review.version > value.review.version)
          continue
        minimumVersion = Math.max(minimumVersion, value.review.version)
        update({ reviewId: link.reviewId, reason: null, detail: value, error: null })
      }
    }
    catch (error) {
      if (opened && current === generation)
        update({ error: String(error) })
    }
    finally {
      busy = false
      if (opened) {
        update({ loading: false })
        if (pending)
          void refresh()
      }
    }
  }
  function event(message: ReviewMessage) {
    if (message.projectPath !== projectPath || (state.reviewId && message.reviewId !== state.reviewId))
      return
    if (message.version <= minimumVersion)
      return
    if (state.reviewId === message.reviewId)
      minimumVersion = message.version
    void refresh()
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    open() {
      opened = true
      generation++
      subscriptions.add(event)
    },
    close() {
      opened = false
      generation++
      pending = false
      subscriptions.delete(event)
    },
    refresh,
    selectRevision(id?: string) {
      revisionId = id
      generation++
      update({ detail: null })
      return refresh()
    },
  }
}
