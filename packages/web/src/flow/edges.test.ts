import type { FlowMessageRecord } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { activeDeliveryEdges, sameDeliveryState } from './edges'

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
  it('keeps an edge lit until the delivery is answered or fails', () => {
    const edges = activeDeliveryEdges([
      record('1', 'open', 'queued'),
      record('2', 'done', 'replied'),
      record('3', 'broken', 'failed'),
      record('4', 'reading', 'delivered'),
    ])
    assert.deepEqual([...edges.keys()], ['open', 'reading'])
  })

  it('treats a status change as a new delivery state', () => {
    const before = [record('1', 'open', 'queued')]
    const after = [record('1', 'open', 'replied')]
    assert.equal(sameDeliveryState(before, before), true)
    assert.equal(sameDeliveryState(before, after), false)
  })
})
