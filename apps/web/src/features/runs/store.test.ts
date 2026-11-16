import type { RunDetail, RunMessage, RunSummary } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { acceptRunDetail, getActivityVersion, loadRunWindow, receiveRun, runProject, subscribeRunEvents } from './store'

it('emits live activity only for accepted SSE revisions, never HTTP hydration or replay', async (t) => {
  const projectPath = '/run-store-live-test'
  const run = { id: 'one', projectPath, roleId: 'coder', orchestratorId: 'owner', revision: 2, status: 'running', progress: { phase: 'thinking' } } as RunSummary
  const events: RunMessage[] = []
  const stop = subscribeRunEvents(message => events.push(message))
  t.after(stop)
  acceptRunDetail(run as RunDetail)
  assert.equal(events.length, 0)
  receiveRun({ type: 'run_updated', projectPath, run: { ...run, revision: 1 } })
  receiveRun({ type: 'run_updated', projectPath, run })
  assert.equal(events.length, 0)
  const before = getActivityVersion()
  const collecting = { ...run, revision: 3, progress: { phase: 'collecting' as const } }
  receiveRun({ type: 'run_updated', projectPath, run: collecting })
  assert.equal(events.length, 1)
  assert.equal(getActivityVersion(), before + 1)
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ projectPath, runs: [{ ...run, revision: 4, status: 'succeeded' }], activeRuns: [], latestRoleRuns: [], nextCursor: null }), { status: 200 }))
  await loadRunWindow(projectPath)
  assert.equal(events.length, 1)
  assert.equal(runProject(projectPath).runs.one?.status, 'succeeded')
  receiveRun({ type: 'run_updated', projectPath, run: collecting })
  assert.equal(events.length, 1)
  assert.equal(runProject(projectPath).runs.one?.status, 'succeeded')
})
