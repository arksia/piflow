import type { RunCommandsPage, RunCommandSummary, RunDeliveryDetail } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createDeliveryReader } from './delivery-reader'

const detail = (revision = 1): RunDeliveryDetail => ({ availability: 'recorded', projectPath: '/project', runId: 'run', revision, commands: { total: 2, nonzero: 1, unknown: 0 }, checkReferences: [] })
const command = (id: string, revision = 1): RunCommandSummary => ({ toolCallId: id, sequence: id === 'one' ? 1 : 2, toolName: 'bash', status: 'succeeded', updatedRevision: revision, incomplete: false, evidenceIncomplete: false, commandPreview: 'pnpm test', commandTruncated: false, commandExitCode: id === 'one' ? 1 : 0 })
const page = (commands: RunCommandSummary[], nextCursor: string | null = null): RunCommandsPage => ({ commands, counts: detail().commands, nextCursor, revision: 1 })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('loads only on demand, paginates all commands and refreshes every loaded page on reconnect', async () => {
  const paths: string[] = []
  let revision = 1
  const reader = createDeliveryReader('/project', 'run', async <T>(path: string) => {
    paths.push(path)
    const url = new URL(path, 'http://localhost')
    assert.equal(url.searchParams.get('projectPath'), '/project')
    return (url.pathname.endsWith('/delivery') ? detail(revision) : url.searchParams.has('cursor') ? page([command('two', revision)]) : page([command('one', revision)], 'page-two')) as T
  })
  assert.equal(paths.length, 0)
  reader.open()
  await reader.refresh(1)
  assert.equal(Object.keys(reader.getSnapshot().commands).length, 1)
  await reader.more()
  assert.equal(Object.keys(reader.getSnapshot().commands).length, 2)
  revision = 3
  const previous = paths.length
  await reader.refresh(3)
  assert.equal(paths.length - previous, 3)
  assert.equal(reader.getSnapshot().commands.one?.updatedRevision, 3)
  assert.equal(reader.getSnapshot().commands.two?.updatedRevision, 3)
  assert.equal(reader.getSnapshot().nextCursor, null)
  reader.close()
  await reader.refresh(4)
  assert.equal(paths.length, previous + 3)
})

it('ignores a closed view response and coalesces refreshes while an older request is in flight', async () => {
  const gate = deferred<RunDeliveryDetail>()
  let reads = 0
  const reader = createDeliveryReader('/project', 'run', async <T>(path: string) => {
    if (path.includes('/delivery')) {
      reads++
      return (reads === 1 ? await gate.promise : detail(3)) as T
    }
    return page([command('one', reads)]) as T
  })
  reader.open()
  const pending = reader.refresh(1)
  reader.close()
  reader.open()
  await reader.refresh(3)
  gate.resolve(detail(1))
  await pending
  assert.equal(reads, 2)
  assert.equal(reader.getSnapshot().detail?.revision, 3)
  assert.equal(reader.getSnapshot().commands.one?.updatedRevision, 2)
  reader.close()
})

it('preserves newer evidence, reports stale versions without a retry loop and permits explicit retry', async () => {
  let revision = 3
  const reader = createDeliveryReader('/project', 'run', async <T>(path: string) => (path.includes('/delivery') ? detail(revision) : page([command('one', revision)])) as T)
  reader.open()
  await reader.refresh(3)
  revision = 2
  await reader.refresh(3)
  assert.match(reader.getSnapshot().error!, /版本落后/)
  assert.equal(reader.getSnapshot().detail?.revision, 3)
  assert.equal(reader.getSnapshot().commands.one?.updatedRevision, 3)
  revision = 4
  await reader.refresh(4)
  assert.equal(reader.getSnapshot().error, null)
  assert.equal(reader.getSnapshot().detail?.revision, 4)
  reader.close()
})

it('keeps the loaded window on partial request failure and rejects mismatched delivery identity', async () => {
  let fail = false
  let wrong = false
  const reader = createDeliveryReader('/project', 'run', async <T>(path: string) => {
    if (path.includes('/delivery'))
      return { ...detail(), runId: wrong ? 'other' : 'run' } as T
    if (fail)
      throw new Error('offline')
    return page([command('one')], 'page-two') as T
  })
  reader.open()
  await reader.refresh(1)
  fail = true
  await reader.more()
  assert.match(reader.getSnapshot().error!, /offline/)
  assert.equal(reader.getSnapshot().nextCursor, 'page-two')
  assert.equal(Object.keys(reader.getSnapshot().commands).length, 1)
  fail = false
  wrong = true
  await reader.refresh(1)
  assert.match(reader.getSnapshot().error!, /身份不匹配/)
  reader.close()
})
