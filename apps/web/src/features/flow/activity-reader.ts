import type { FlowActivityPage, FlowActivityQuery } from '@piflow/protocol'
import { buildFlowActivityPath } from '@piflow/protocol'
import { api } from '../../session/api'

export function createActivityReader(query: Omit<FlowActivityQuery, 'cursor'>, request = api) {
  let state = { page: null as FlowActivityPage | null, loading: false, error: null as string | null, stale: true }
  const listeners = new Set<() => void>()
  let opened = false
  let busy = false
  let generation = 0
  let pending = false
  function update(value: Partial<typeof state>) {
    state = { ...state, ...value }
    for (const listener of listeners) listener()
  }
  async function read(more = false) {
    if (!opened || (more && (busy || !state.page?.nextCursor)))
      return
    if (!more) {
      generation++
      pending = true
      update({ stale: true })
    }
    if (busy)
      return
    busy = true
    update({ loading: true })
    try {
      do {
        pending = false
        const current = generation
        const cursor = more ? state.page?.nextCursor ?? undefined : undefined
        const page = await request<FlowActivityPage>(buildFlowActivityPath({ ...query, cursor }))
        if (!opened)
          break
        if (current !== generation) {
          more = false
          continue
        }
        if (page.projectPath !== query.projectPath)
          throw new Error('关注列表的项目身份不匹配。')
        const items = cursor ? [...new Map([...(state.page?.items ?? []), ...page.items].map(item => [item.id, item])).values()] : page.items
        update({ page: { ...page, items }, error: null, stale: false })
        more = false
      } while (pending)
    }
    catch (error) {
      if (opened)
        update({ error: String(error), stale: true })
    }
    finally {
      busy = false
      if (opened) {
        update({ loading: false })
        if (pending)
          void read()
      }
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
    open() { opened = true },
    close() {
      opened = false
      generation++
      pending = false
    },
    refresh: () => read(),
    more: () => read(true),
  }
}
