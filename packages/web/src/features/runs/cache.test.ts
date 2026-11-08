import type { RunOutputChunk, RunSummary, RunToolSummary } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { mergeOutput, mergeRuns, mergeTools } from './cache'
import { runLanes, runOrder, runPlacement, timelineRange, timelineTicks } from './time'

it('keeps newer SSE facts when older HTTP pages arrive and never merges concurrent role runs', () => {
  const live = { id: 'one', roleId: 'code', status: 'succeeded', revision: 5 } as RunSummary
  const two = { ...live, id: 'two', status: 'running' as const }
  const current = { one: live, two }
  assert.strictEqual(mergeRuns(current, [{ ...live, revision: 4, status: 'running' }]), current)
  assert.equal(Object.keys(mergeRuns({}, [live, two])).length, 2)
  const tool = { toolCallId: 'read', updatedRevision: 8, status: 'failed' } as RunToolSummary
  assert.strictEqual(mergeTools({ read: tool }, [{ ...tool, updatedRevision: 7, status: 'running' }]).read, tool)
})
it('appends output once, resets corrected text and bounds the retained window', () => {
  const first: RunOutputChunk = { text: '草稿', reset: true, version: 1, baseOffset: 0, endOffset: 2, truncated: false, revision: 1 }
  const initial = mergeOutput(null, first)
  const appended = mergeOutput(initial, { ...first, text: '内容', reset: false, baseOffset: 2, endOffset: 4, revision: 2 })
  assert.equal(appended.text, '草稿内容')
  assert.strictEqual(mergeOutput(appended, first), appended)
  const corrected = mergeOutput(appended, { ...first, version: 2, text: '最终报告', endOffset: 4, revision: 3 })
  assert.equal(corrected.text, '最终报告')
  assert.throws(() => mergeOutput(corrected, { ...first, reset: false, baseOffset: 5, revision: 4 }), /游标/)
  const bounded = mergeOutput({ ...first, reset: false, text: 'a'.repeat(160000), endOffset: 160000 }, { ...first, reset: false, text: 'b', baseOffset: 160000, endOffset: 160001, revision: 2 })
  assert.equal(bounded.text.length, 160000)
  assert.equal(bounded.baseOffset, 1)
  assert.equal(bounded.truncated, true)
})
it('keeps creation order stable and ends interrupted timelines at the last observed fact', () => {
  const one = { id: 'a', createdAt: '2026-01-01T00:00:00.000Z', lastObservedAt: '2026-01-01T00:00:02.000Z', interruptedAt: '2026-01-01T01:00:00.000Z', status: 'interrupted' } as RunSummary
  const two = { ...one, id: 'b', completedAt: '2026-01-01T00:00:03.000Z', status: 'succeeded' as const }
  assert.deepEqual([one, two].sort(runOrder).map(run => run.id), ['b', 'a'])
  const range = timelineRange([one, two], Date.parse('2026-01-01T02:00:00.000Z'))
  assert.equal(range.end - range.start, 3000)
})
it('packs overlapping calls into distinct tracks and reuses a track after completion', () => {
  const run = { roleId: 'code', roleName: 'Code', orchestratorId: 'main', orchestratorName: 'Main', status: 'succeeded' } as RunSummary
  const at = (seconds: number) => new Date(seconds * 1000).toISOString()
  const rows = [
    { ...run, id: 'a', createdAt: at(0), completedAt: at(10) },
    { ...run, id: 'b', createdAt: at(5), completedAt: at(15) },
    { ...run, id: 'c', createdAt: at(10), completedAt: at(20) },
    { ...run, orchestratorId: 'other', id: 'd', createdAt: at(0), completedAt: at(10) },
  ]
  const lanes = runLanes(rows.reverse(), 20000)
  assert.equal(lanes.length, 2)
  const main = lanes.find(lane => lane.id === 'main:code')!
  assert.deepEqual(main.tracks.map(track => track.map(run => run.id)), [['a', 'c'], ['b']])
})

it('keeps dense short-task hit targets separate at different viewport widths', () => {
  const base = { roleId: 'code', roleName: 'Code', orchestratorId: 'main', orchestratorName: 'Main', status: 'succeeded' } as RunSummary
  const at = (seconds: number) => new Date(seconds * 1000).toISOString()
  const rows = [0, 1, 2, 300].map((seconds, i) => ({ ...base, id: String(i), createdAt: at(seconds), completedAt: at(seconds + 1) }))
  for (const width of [160, 344, 900]) {
    const viewport = { start: 0, end: 1800000, width }
    const lanes = runLanes(rows, 1800000, viewport)
    assert.equal(lanes[0]!.tracks.length, 3)
    for (const track of lanes[0]!.tracks) {
      let previousEnd = -4
      for (const run of track) {
        const placed = runPlacement(run, 1800000, viewport)
        assert.ok(placed.marker)
        assert.ok(placed.left >= previousEnd + 4)
        assert.ok(placed.left + placed.width <= width)
        previousEnd = placed.left + placed.width
      }
    }
  }
})

it('clips tasks to the visible window and uses sparse readable ticks', () => {
  const viewport = { start: 1000, end: 1801000, width: 344 }
  const run = { createdAt: new Date(0).toISOString(), completedAt: new Date(2000000).toISOString(), status: 'succeeded' } as RunSummary
  assert.deepEqual(runPlacement(run, 2000000, viewport), { left: 0, width: 344, marker: false })
  const edge = { ...run, createdAt: new Date(1800000).toISOString() }
  assert.deepEqual(runPlacement(edge, 2000000, viewport), { left: 326, width: 18, marker: true })
  const ticks = timelineTicks(viewport.start, viewport.end, viewport.width)
  assert.ok(ticks.length > 0 && ticks.length <= 3)
  assert.ok(ticks.every(tick => tick % 600000 === 0))
})
