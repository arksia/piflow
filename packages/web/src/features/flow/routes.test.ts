import assert from 'node:assert/strict'
import { it } from 'node:test'
import { NODE_LABEL_GAP } from './geometry'
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

it('escapes below an icon through the label gap and avoids its own and foreign text', () => {
  const nodes = [
    { id: 'a', x: 0, y: 0, size: 46, bounds: { x: -82, y: -33, width: 164, height: 154 } },
    { id: 'b', x: 0, y: 360, size: 46, bounds: { x: -82, y: 327, width: 164, height: 154 } },
    { id: 'block', x: -110, y: 180, size: 46, bounds: { x: -160, y: 150, width: 100, height: 100 } },
  ]
  const route = routeGraphEdges([{ id: 'e', source: 'a', target: 'b' }], nodes).get('e')!
  assert.deepEqual(route[0], { x: 0, y: 23 })
  assert.equal(route[1]!.x, 0)
  assert.ok(route[1]!.y > 23 && route[1]!.y < 23 + NODE_LABEL_GAP)
  assert.deepEqual(route.at(-1), { x: 0, y: 337 })
  const text = nodes.slice(0, 2).map(node => ({ ...node.bounds, y: node.y + node.size / 2 + NODE_LABEL_GAP, height: node.bounds.y + node.bounds.height - (node.y + node.size / 2 + NODE_LABEL_GAP) }))
  for (const rect of [...text, nodes[2]!.bounds]) {
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]!
      const b = route[i]!
      assert.ok(a.x === b.x || a.y === b.y)
      assert.ok(!(a.x === b.x
        ? a.x > rect.x && a.x < rect.x + rect.width && Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.height
        : a.y > rect.y && a.y < rect.y + rect.height && Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.width))
    }
  }
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
