import type { RunCommandsPage, RunCommandSummary, RunDeliveryDetail } from '@piflow/protocol'
import { buildRunsPath } from '@piflow/protocol'
import { api } from '../../session/api'

export interface DeliveryWindow {
  detail: RunDeliveryDetail | null
  commands: Record<string, RunCommandSummary>
  nextCursor: string | null
  loading: boolean
  error: string | null
}
/** One serial reader owns the loaded command window and ignores work after close. */
export function createDeliveryReader(projectPath: string, runId: string, request = api) {
  let state: DeliveryWindow = { detail: null, commands: {}, nextCursor: null, loading: false, error: null }
  const listeners = new Set<() => void>()
  const cursors: (string | undefined)[] = [undefined]
  let generation = 0
  let open = false
  let busy = false
  let refreshPending = false
  let morePending = false
  let minimumRevision = 0
  const suffix = `/${encodeURIComponent(runId)}`
  function update(value: Partial<DeliveryWindow>) {
    state = { ...state, ...value }
    for (const listener of listeners) listener()
  }
  async function pump() {
    if (busy || !open)
      return
    busy = true
    update({ loading: true, error: null })
    try {
      while (refreshPending || morePending) {
        if (!open)
          break
        const requestGeneration = generation
        const requestedRevision = minimumRevision
        const more = !refreshPending && morePending
        if (more)
          morePending = false
        else refreshPending = false
        if (more && !state.nextCursor)
          continue
        const queryCursors = more ? [state.nextCursor!] : [...cursors]
        const results = await Promise.allSettled([
          request<RunDeliveryDetail>(buildRunsPath(projectPath, `${suffix}/delivery`)),
          ...queryCursors.map(cursor => request<RunCommandsPage>(buildRunsPath(projectPath, `${suffix}/commands`, { cursor }))),
        ])
        if (!open || requestGeneration !== generation)
          continue
        const failure = results.find(result => result.status === 'rejected')
        if (failure?.status === 'rejected')
          throw failure.reason
        const [detail, ...pages] = results.map(result => (result as PromiseFulfilledResult<RunDeliveryDetail | RunCommandsPage>).value) as [RunDeliveryDetail, ...RunCommandsPage[]]
        if (detail.projectPath !== projectPath || detail.runId !== runId)
          throw new Error('交付记录的项目或运行身份不匹配')
        if (detail.revision < minimumRevision) {
          if (requestedRevision < minimumRevision) {
            refreshPending = true
            continue
          }
          throw new Error('返回的交付版本落后于已观察到的运行版本，请重试')
        }
        const commands = { ...state.commands }
        for (const page of pages) {
          for (const command of page.commands) {
            if ((commands[command.toolCallId]?.updatedRevision ?? -1) <= command.updatedRevision)
              commands[command.toolCallId] = command
          }
        }
        if (more)
          cursors.push(queryCursors[0])
        update({ detail: (state.detail?.revision ?? -1) > detail.revision ? state.detail : detail, commands, nextCursor: pages.at(-1)!.nextCursor })
      }
    }
    catch (error) {
      if (open) {
        refreshPending = false
        morePending = false
        update({ error: `交付同步失败，记录可能过期：${String(error)}` })
      }
    }
    finally {
      busy = false
      if (open)
        update({ loading: false })
    }
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
      open = true
      generation++
    },
    close() {
      open = false
      generation++
      refreshPending = false
      morePending = false
    },
    refresh(revision = 0) {
      minimumRevision = Math.max(minimumRevision, revision)
      refreshPending = true
      return pump()
    },
    more() {
      morePending = true
      return pump()
    },
  }
}
