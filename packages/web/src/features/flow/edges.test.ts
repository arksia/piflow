import type { FlowMessageRecord, SubagentRun } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { changedDeliveryActivities, changedRunActivities, sameDeliveryState, subagentCallEdges } from './edges'

function record(id: string, edgeId: string, status: FlowMessageRecord['status']): FlowMessageRecord {
  return {
    id,
    edgeId,
    source: 'a',
    target: 'b',
    body: 'body',
    preview: 'body',
    sentAt: '2026-10-25T00:00:00.000Z',
    status,
    read: status !== 'queued',
    reminded: false,
  }
}

describe('flow delivery edges', () => {
  it('treats a status change as a new delivery state', () => {
    const before = [record('1', 'open', 'queued')]
    const after = [record('1', 'open', 'replied')]
    assert.equal(sameDeliveryState(before, before), true)
    assert.equal(sameDeliveryState(before, after), false)
  })

  it('keeps concurrent messages on one edge as separate activities', () => {
    const activities = changedDeliveryActivities([], [
      record('1', 'shared', 'queued'),
      record('2', 'shared', 'delivered'),
    ])
    assert.deepEqual(activities.map(activity => [activity.messageId, activity.kind]), [
      ['1', 'request'],
      ['2', 'request'],
    ])
  })

  it('emits a response or failure only when a delivery changes outcome', () => {
    const before = [record('1', 'shared', 'delivered'), record('2', 'shared', 'delivered')]
    const after = [record('1', 'shared', 'replied'), record('2', 'shared', 'failed')]
    assert.deepEqual(changedDeliveryActivities(before, after).map(activity => [activity.messageId, activity.kind]), [
      ['1', 'response'],
      ['2', 'error'],
    ])
  })
})

it('keeps concurrent calls separate and routes shared roles to the caller reference without persistent edges', () => {
  const first = { id: 'run-1', orchestratorId: 'main', roleId: 'role', status: 'running' } as SubagentRun
  const second = { ...first, id: 'run-2' }
  const activities = changedRunActivities([], [first, second])
  assert.deepEqual(activities.map(item => item.messageId), ['run-1', 'run-2'])
  const nodes = [{ id: 'main', data: {} }, { id: 'role', data: { displayOwnerId: 'other' } }, { id: 'shared-ref', data: { agentId: 'role', displayOwnerId: 'main' } }]
  const calls = subagentCallEdges([first, second], activities, nodes)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.target, 'shared-ref')
  const done = [{ ...first, status: 'succeeded' as const }, { ...second, status: 'failed' as const }]
  assert.deepEqual(changedRunActivities([first, second], done).map(item => item.kind), ['response', 'error'])
  assert.deepEqual(subagentCallEdges(done, [], nodes), [])
})
