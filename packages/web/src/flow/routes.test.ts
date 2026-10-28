import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { roundedOrthogonalPath, routeGraphEdges } from './routes'

const edges = [{ id: 'ab', source: 'a', target: 'b' }]
const nodes = [{ id: 'a', x: 0, y: 0, size: 51 }, { id: 'b', x: 200, y: 100, size: 51 }]

describe('Agent Graph peer routing', () => {
  it('matches the bundle single-elbow path and 8px corner', () => {
    const points = routeGraphEdges(edges, nodes).get('ab')!
    assert.equal(roundedOrthogonalPath(points), 'M0 0L192 0Q200 0 200 8L200 100')
  })

  it('switches elbow direction when the other option intersects fewer icons', () => {
    const points = routeGraphEdges(edges, [...nodes, { id: 'c', x: 100, y: 0, size: 51 }]).get('ab')!
    assert.equal(roundedOrthogonalPath(points), 'M0 0L0 92Q0 100 8 100L200 100')
  })

  it('fans shared-side edges into ordered lanes inside the icon', () => {
    const routes = routeGraphEdges([...edges, { id: 'ac', source: 'a', target: 'c' }], [...nodes, { id: 'c', x: 300, y: 200, size: 51 }])
    assert.deepEqual(routes.get('ab')![0], { x: 0, y: 4 })
    assert.deepEqual(routes.get('ac')![0], { x: 0, y: -4 })
    assert.equal(roundedOrthogonalPath(routes.get('ab')!), 'M0 4L192 4Q200 4 200 12L200 100')
  })

  it('preserves path geometry when the stored edge direction is reversed', () => {
    const forwards = routeGraphEdges(edges, nodes).get('ab')!
    const backwards = routeGraphEdges([{ id: 'ba', source: 'b', target: 'a' }], nodes).get('ba')!
    assert.deepEqual(backwards, [...forwards].reverse())
  })

  it('keeps near-aligned endpoints straight and avoids tiny corners', () => {
    const points = routeGraphEdges(edges, [nodes[0]!, { id: 'b', x: 0.4, y: 100, size: 51 }]).get('ab')!
    assert.equal(roundedOrthogonalPath(points), 'M0 0L0 100')
  })

  it('compresses crowded lanes to the icon width without changing saved nodes', () => {
    const targets = Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, x: 200 + i * 100, y: 100 + i * 100, size: 51 }))
    const graphNodes = [nodes[0]!, ...targets]
    const original = structuredClone(graphNodes)
    const routes = routeGraphEdges(targets.map(node => ({ id: node.id, source: 'a', target: node.id })), graphNodes)
    for (const points of routes.values()) {
      assert.ok(points.length <= 3)
      assert.ok(Math.hypot(points[0]!.x, points[0]!.y) <= 51 * 0.3 + 0.001)
    }
    assert.deepEqual(graphNodes, original)
  })

  it('skips missing endpoints without creating any topology', () => {
    assert.equal(routeGraphEdges(edges, [nodes[0]!]).size, 0)
  })
})
