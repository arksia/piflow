import type { FlowMessageRecord } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { changedDeliveryActivities, roundedOrthogonalPath, routeOrthogonalPoints, sameDeliveryState } from './edges'

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

describe('Agent Graph edge routing', () => {
  it('routes center-to-center around intervening nodes with rounded orthogonal corners', () => {
    const source = { x: 0, y: 0 }
    const target = { x: 400, y: 0 }
    const obstacle = { x: 150, y: -40, width: 100, height: 80 }
    const points = routeOrthogonalPoints(source, target, [obstacle])
    const path = roundedOrthogonalPath(points)

    assert.deepEqual(points[0], source)
    assert.deepEqual(points.at(-1), target)
    assert.ok(points.slice(1).every((point, index) => point.x === points[index]!.x || point.y === points[index]!.y))
    assert.match(path, /Q /)
    for (const point of points) {
      assert.equal(point.x > obstacle.x && point.x < obstacle.x + obstacle.width && point.y > obstacle.y && point.y < obstacle.y + obstacle.height, false)
    }
    for (let index = 1; index < points.length; index++) {
      const from = points[index - 1]!
      const to = points[index]!
      if (from.y === to.y)
        assert.equal(from.y > obstacle.y && from.y < obstacle.y + obstacle.height && Math.max(Math.min(from.x, to.x), obstacle.x) < Math.min(Math.max(from.x, to.x), obstacle.x + obstacle.width), false)
      else
        assert.equal(from.x > obstacle.x && from.x < obstacle.x + obstacle.width && Math.max(Math.min(from.y, to.y), obstacle.y) < Math.min(Math.max(from.y, to.y), obstacle.y + obstacle.height), false)
    }
  })

  it('uses a straight path when no bend is needed', () => {
    const points = routeOrthogonalPoints({ x: 0, y: 0 }, { x: 300, y: 0 }, [])
    assert.deepEqual(points, [{ x: 0, y: 0 }, { x: 300, y: 0 }])
  })

  it('finds a route when both endpoints must leave horizontally before bypassing an obstacle', () => {
    const obstacles = [
      { x: -20, y: -200, width: 40, height: 150 },
      { x: -20, y: 50, width: 40, height: 150 },
      { x: 580, y: -200, width: 40, height: 150 },
      { x: 580, y: 50, width: 40, height: 150 },
      { x: 250, y: -40, width: 100, height: 80 },
    ]
    const points = routeOrthogonalPoints({ x: 0, y: 0 }, { x: 600, y: 0 }, obstacles)
    assert.ok(points.length >= 6)
    for (let index = 1; index < points.length; index++) {
      const from = points[index - 1]!
      const to = points[index]!
      assert.ok(from.x === to.x || from.y === to.y)
      for (const rect of obstacles) {
        const crosses = from.y === to.y
          ? from.y > rect.y && from.y < rect.y + rect.height && Math.max(Math.min(from.x, to.x), rect.x) < Math.min(Math.max(from.x, to.x), rect.x + rect.width)
          : from.x > rect.x && from.x < rect.x + rect.width && Math.max(Math.min(from.y, to.y), rect.y) < Math.min(Math.max(from.y, to.y), rect.y + rect.height)
        assert.equal(crosses, false)
      }
    }
  })
})
