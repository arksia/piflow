import assert from 'node:assert/strict'
import { it } from 'node:test'
import { roundedOrthogonalPath, routeGraphEdges } from './routes'

it('routes around full labels with multiple rounded corners and reversible geometry', () => {
  const nodes = [
    { id: 'a', x: 50, y: 30, size: 46, bounds: { x: 0, y: 0, width: 100, height: 150 } },
    { id: 'b', x: 450, y: 30, size: 46, bounds: { x: 400, y: 0, width: 100, height: 150 } },
    { id: 'label', x: 250, y: -60, size: 40, bounds: { x: 180, y: -90, width: 140, height: 240 } },
  ]
  const route = routeGraphEdges([{ id: 'edge', source: 'a', target: 'b' }], nodes).get('edge')!
  assert.ok(route.length > 3)
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!
    const b = route[i]!
    assert.ok(a.x === b.x || a.y === b.y)
    assert.ok(!(Math.min(a.x, b.x) < 320 && Math.max(a.x, b.x) > 180 && Math.min(a.y, b.y) < 150 && Math.max(a.y, b.y) > -90))
  }
  assert.deepEqual(routeGraphEdges([{ id: 'edge', source: 'b', target: 'a' }], nodes).get('edge'), [...route].reverse())
  assert.ok((roundedOrthogonalPath(route).match(/Q/g) ?? []).length > 1)
})

it('fans crowded ports within icon edges and skips missing endpoints', () => {
  const nodes = [{ id: 'a', x: 0, y: 0, size: 46 }, ...Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, x: 200 + i * 100, y: 100 + i * 150, size: 40 }))]
  const before = structuredClone(nodes)
  const routes = routeGraphEdges(nodes.slice(1).map(node => ({ id: node.id, source: 'a', target: node.id })), nodes)
  for (const route of routes.values()) {
    assert.equal(route[0]!.x, 23)
    assert.ok(Math.abs(route[0]!.y) <= 46 / 4)
  }
  assert.deepEqual(nodes, before)
  assert.equal(routeGraphEdges([{ id: 'bad', source: 'a', target: 'missing' }], nodes).size, 0)
  assert.equal(roundedOrthogonalPath([]), '')
  assert.equal(roundedOrthogonalPath([{ x: 0, y: 0 }, { x: 100, y: 0 }]), 'M0 0L100 0')
})
