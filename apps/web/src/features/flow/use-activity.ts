import type { FlowActivityKind } from '@piflow/protocol'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { subscribeReviewEvents } from '../runs/review-reader'
import { getRunsConnection, subscribeRunEvents, subscribeRuns } from '../runs/store'
import { createActivityReader } from './activity-reader'

export function useFlowActivity(projectPath: string, orchestratorId: string | undefined, kind: FlowActivityKind | undefined, active: boolean) {
  useSyncExternalStore(subscribeRuns, () => getRunsConnection().version, () => 0)
  const connectionVersion = getRunsConnection().version
  const reader = useMemo(() => createActivityReader({ projectPath, orchestratorId, kind }), [projectPath, orchestratorId, kind])
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot)
  useEffect(() => {
    if (!active)
      return
    reader.open()
    let timer: ReturnType<typeof setTimeout> | undefined
    function invalidate(event: { projectPath: string }) {
      if (event.projectPath !== projectPath)
        return
      if (timer !== undefined)
        return
      timer = setTimeout(() => {
        timer = undefined
        if (document.visibilityState !== 'hidden')
          void reader.refresh()
      }, 200)
    }
    function visible() {
      if (document.visibilityState !== 'hidden')
        void reader.refresh()
    }
    visible()
    const stopRuns = subscribeRunEvents((message, previous) => {
      if (message.type === 'run_updated' && previous && previous.status === message.run.status && previous.progress?.phase === message.run.progress?.phase && previous.deliveryRevision === message.run.deliveryRevision)
        return
      invalidate(message)
    })
    const stopReviews = subscribeReviewEvents(invalidate)
    document.addEventListener('visibilitychange', visible)
    return () => {
      reader.close()
      clearTimeout(timer)
      stopRuns()
      stopReviews()
      document.removeEventListener('visibilitychange', visible)
    }
  }, [reader, projectPath, active, connectionVersion])
  return { ...state, connectionVersion, refresh: reader.refresh, more: reader.more }
}
