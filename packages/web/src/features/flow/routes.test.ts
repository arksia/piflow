import assert from 'node:assert/strict'
import { it } from 'node:test'
import { roundedOrthogonalPath, routeGraphEdges } from './routes'

it('routes around icons with multiple rounded corners and reversible geometry', () => {
  const nodes = [
    { id: 'a', x: 50, y: 30, size: 46, bounds: { x: 0, y: 0, width: 100, height: 150 } },
    { id: 'b', x: 450, y: 30, size: 46, bounds: { x: 400, y: 0, width: 100, height: 150 } },
    { id: 'block', x: 250, y: 30, size: 100 },
  ]
  const route = routeGraphEdges([{ id: 'edge', source: 'a', target: 'b' }], nodes).get('edge')!
  assert.ok(route.length > 3)
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!
    const b = route[i]!
    assert.ok(a.x === b.x || a.y === b.y)
    assert.ok(!(Math.min(a.x, b.x) < 300 && Math.max(a.x, b.x) > 200 && Math.min(a.y, b.y) < 80 && Math.max(a.y, b.y) > -20))
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

it('uses all four sides, including straight vertical and mixed-axis connections', () => {
  const origin = { id: 'a', x: 0, y: 0, size: 46 }
  for (const [x, y, start, end] of [
    [0, 300, { x: 0, y: 23 }, { x: 0, y: 277 }],
    [0, -300, { x: 0, y: -23 }, { x: 0, y: -277 }],
    [300, 0, { x: 23, y: 0 }, { x: 277, y: 0 }],
    [-300, 0, { x: -23, y: 0 }, { x: -277, y: 0 }],
  ] as const) {
    const route = routeGraphEdges([{ id: 'e', source: 'a', target: 'b' }], [origin, { id: 'b', x, y, size: 46 }]).get('e')!
    assert.deepEqual(route, [start, end])
  }
  const route = routeGraphEdges([{ id: 'e', source: 'a', target: 'b' }], [origin, { id: 'b', x: 300, y: 300, size: 46 }]).get('e')!
  assert.equal(route.length, 3)
  assert.ok(route[0]!.y === 23 || route.at(-1)!.y === 277)
})

it('connects vertically through its own and other titles without a detour', () => {
  const nodes = [
    { id: 'a', x: 0, y: 0, size: 46, bounds: { x: -82, y: -33, width: 164, height: 154 } },
    { id: 'b', x: 0, y: 360, size: 46, bounds: { x: -82, y: 327, width: 164, height: 154 } },
    { id: 'title', x: 80, y: 150, size: 46, bounds: { x: -20, y: 117, width: 200, height: 154 } },
  ]
  const route = routeGraphEdges([{ id: 'e', source: 'a', target: 'b' }], nodes).get('e')!
  assert.deepEqual(route, [{ x: 0, y: 23 }, { x: 0, y: 337 }])
  const resizedTitles = nodes.map(node => ({ ...node, bounds: { ...node.bounds, width: 500, height: 500 } }))
  assert.deepEqual(routeGraphEdges([{ id: 'e', source: 'a', target: 'b' }], resizedTitles).get('e'), route)
  assert.deepEqual(routeGraphEdges([{ id: 'e', source: 'b', target: 'a' }], nodes.slice().reverse()).get('e'), route.slice().reverse())
})

it('fans vertical ports in geometric order with stable input and edge direction', () => {
  const nodes = [{ id: 'a', x: 0, y: 0, size: 46 }, ...Array.from({ length: 7 }, (_, i) => ({ id: `b${i}`, x: (i - 3) * 90, y: 600, size: 40 }))]
  const edges = nodes.slice(1).map(node => ({ id: node.id, source: 'a', target: node.id }))
  const routes = routeGraphEdges(edges, nodes)
  const offsets = [...routes.values()].map(route => route[0]!.x)
  assert.equal(new Set(offsets).size, 7)
  assert.deepEqual(offsets, offsets.slice().sort((a, b) => a - b))
  for (const route of routes.values()) {
    assert.equal(route[0]!.y, 23)
    assert.ok(Math.abs(route[0]!.x) <= 46 / 4)
  }
  const reversed = routeGraphEdges(edges.slice().reverse().map(edge => ({ ...edge, source: edge.target, target: edge.source })), nodes.slice().reverse())
  for (const [id, route] of routes)
    assert.deepEqual(reversed.get(id), route.slice().reverse())
})
