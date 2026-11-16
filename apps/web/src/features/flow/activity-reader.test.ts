import type { FlowActivityPage } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createActivityReader } from './activity-reader'

function page(projectPath = '/project', id = 'one'): FlowActivityPage {
  return { projectPath, observedAt: '', totals: { running: 0, latestFailures: 0, cancelled: 0, pendingReviews: 0, unreadTargets: 0, changesRequested: 0, inProgressReviews: 0, unavailableReviews: 0, uncoveredChanges: 0 }, groups: [], items: [{ id, kind: 'running', orchestratorId: 'owner', title: id, description: '', updatedAt: '', count: 1, target: { kind: 'run', runId: id } }], nextCursor: 'next' }
}
it('discards invalidated in-flight pages, resets pagination and keeps stale results on failure', async () => {
  let resolve!: (value: FlowActivityPage) => void
  let count = 0
  let fail = false
  const paths: string[] = []
  const reader = createActivityReader({ projectPath: '/project' }, async <T>(path: string) => {
    paths.push(path)
    if (++count === 1) {
      return new Promise<FlowActivityPage>((done) => {
        resolve = done
      }) as Promise<T>
    }
    if (fail)
      throw new Error('offline')
    return page('/project', path.includes('cursor=') ? 'two' : 'fresh') as T
  })
  reader.open()
  const first = reader.refresh()
  void reader.refresh()
  resolve(page('/project', 'stale'))
  await first
  assert.deepEqual(reader.getSnapshot().page?.items.map(item => item.id), ['fresh'])
  await reader.more()
  assert.deepEqual(reader.getSnapshot().page?.items.map(item => item.id), ['fresh', 'two'])
  await reader.refresh()
  assert.deepEqual(reader.getSnapshot().page?.items.map(item => item.id), ['fresh'])
  fail = true
  await reader.refresh()
  assert.equal(reader.getSnapshot().stale, true)
  assert.match(reader.getSnapshot().error!, /offline/)
  assert.equal(reader.getSnapshot().page?.items[0]?.id, 'fresh')
  reader.close()
  const before = paths.length
  await reader.refresh()
  assert.equal(paths.length, before)
})
it('rejects cross-project responses and closes before a late response', async () => {
  const reader = createActivityReader({ projectPath: '/project' }, async <T>() => page('/other') as T)
  reader.open()
  await reader.refresh()
  assert.equal(reader.getSnapshot().page, null)
  assert.match(reader.getSnapshot().error!, /项目身份/)
  reader.close()
  let resolve!: (value: FlowActivityPage) => void
  const late = createActivityReader({ projectPath: '/project' }, async <T>() => new Promise<FlowActivityPage>((done) => {
    resolve = done
  }) as Promise<T>)
  late.open()
  const pending = late.refresh()
  late.close()
  resolve(page())
  await pending
  assert.equal(late.getSnapshot().page, null)
})
