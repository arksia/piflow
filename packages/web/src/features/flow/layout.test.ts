import assert from 'node:assert/strict'
import { it } from 'node:test'
import { arrangeNodes, layoutFingerprint, nodeRect, overlaps } from './layout'

it('packs cyclic groups and isolates deterministically without changing authored input', () => {
  const nodes = Array.from({ length: 13 }, (_, i) => ({ id: `node-${i}`, position: { x: i * 400, y: i % 2 * 600 }, measured: { width: 164, height: i === 1 ? 210 : 154 } }))
  const links = [{ source: 'node-0', target: 'node-1' }, { source: 'node-1', target: 'node-2' }, { source: 'node-2', target: 'node-0' }]
  const before = structuredClone(nodes)
  const positions = arrangeNodes(nodes, links)
  assert.deepEqual([...positions], [...arrangeNodes([...nodes].reverse(), [...links].reverse())])
  const rects = nodes.map(node => nodeRect({ ...node, position: positions.get(node.id)! }))
  rects.forEach((rect, i) => rects.slice(i + 1).forEach(other => assert.equal(overlaps(rect, other), false)))
  assert.ok(Math.max(...rects.map(rect => rect.x + rect.width)) < 1200)
  assert.deepEqual(nodes, before)
  assert.equal(arrangeNodes([], []).size, 0)
})

it('invalidates layout undo for authored moves and links, not ordinary field updates', () => {
  const nodes = [{ id: 'a', position: { x: 0, y: 0 } }]
  const input = { nodes, edges: [], memberships: [] } as unknown as Parameters<typeof layoutFingerprint>[0]
  assert.equal(layoutFingerprint(input), layoutFingerprint({ ...input, nodes: input.nodes.map(node => ({ ...node, name: 'new name' })) }))
  assert.notEqual(layoutFingerprint(input), layoutFingerprint({ ...input, nodes: input.nodes.map(node => ({ ...node, position: { x: 10, y: 0 } })) }))
})

it('keeps a cyclic graph in two dimensions without assigning parent/child columns', () => {
  const nodes = Array.from({ length: 6 }, (_, i) => ({ id: String(i), position: { x: 0, y: 0 } }))
  const links = nodes.map((node, i) => ({ source: node.id, target: nodes[(i + 1) % nodes.length]!.id }))
  const positions = arrangeNodes(nodes, links)
  assert.ok(new Set([...positions.values()].map(point => Math.round(point.x))).size > 3)
  assert.ok(new Set([...positions.values()].map(point => Math.round(point.y))).size > 3)
  assert.deepEqual([...positions], [...arrangeNodes([...nodes].reverse(), links.map(link => ({ source: link.target, target: link.source })).reverse())])
  const rects = nodes.map(node => nodeRect({ ...node, position: positions.get(node.id)! }))
  rects.forEach((rect, i) => rects.slice(i + 1).forEach(other => assert.equal(overlaps(rect, other), false)))
})
