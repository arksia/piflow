import type { RunSummary } from '@piflow/protocol'
import type { FlowCanvasNode } from './components/FlowSessionNode'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { projectMembers } from './members'

const nodes = [
  { id: 'a', position: { x: 0, y: 0 }, data: { orchestrationEnabled: true } },
  { id: 'b', position: { x: 500, y: 0 }, data: { orchestrationEnabled: true } },
  { id: 'worker', position: { x: 900, y: 900 }, data: { kind: 'subagent-role' } },
  { id: 'unassigned', position: { x: 1200, y: 900 }, data: { kind: 'subagent-role' } },
] as FlowCanvasNode[]
const memberships = [{ orchestratorId: 'a', memberId: 'worker' }, { orchestratorId: 'b', memberId: 'worker' }]

it('keeps overview and team identities separate without mutating topology', () => {
  const before = structuredClone(nodes)
  assert.deepEqual(projectMembers(nodes, memberships, null).nodes.map(node => node.id), ['a', 'b'])
  for (const ownerId of ['a', 'b']) {
    const view = projectMembers(nodes, memberships, ownerId)
    assert.deepEqual(view.nodes.map(node => node.id), [ownerId, 'worker'])
    assert.equal(view.nodes[1]?.data.displayOwnerId, ownerId)
    assert.equal(view.nodes[1]?.data.referenceLabel, '共享角色')
    assert.equal(view.nodes[1]?.deletable, false)
    assert.equal(view.edges.length, 1)
    assert.equal(view.edges[0]?.source, ownerId)
    assert.notDeepEqual(view.nodes[1]?.position, nodes[2]?.position)
  }
  assert.deepEqual(nodes, before)
  assert.deepEqual(projectMembers(nodes, [], 'a').nodes.map(node => node.id), ['a'])
})

it('preserves saved group positions when members change, independently of authored positions', () => {
  const saved = { a: { x: 100, y: 100 } }
  const view = projectMembers(nodes, memberships, 'a', saved)
  assert.deepEqual(view.nodes[0]?.position, saved.a)
  assert.notDeepEqual(view.nodes[1]?.position, saved.a)
  const both = Object.fromEntries(view.nodes.map(node => [node.id, node.position]))
  const again = projectMembers(nodes, [...memberships, { orchestratorId: 'a', memberId: 'unassigned' }], 'a', both)
  assert.deepEqual(again.nodes.slice(0, 2).map(node => node.position), view.nodes.map(node => node.position))
  assert.deepEqual(saved, { a: { x: 100, y: 100 } })
})

it('projects concurrent, nonmember, deleted and analysis identities without changing membership', () => {
  const call = { id: 'one', orchestratorId: 'a', roleId: 'unassigned', roleName: 'Worker', purpose: 'task' } as RunSummary
  const runs: RunSummary[] = [call, { ...call, id: 'two' }, { ...call, id: 'deleted', roleId: 'deleted', roleName: 'Former role' }, { ...call, id: 'analysis', roleId: 'review-analysis', purpose: 'review-analysis' }, { ...call, id: 'foreign', orchestratorId: 'b', roleId: 'foreign' }]
  const view = projectMembers(nodes, memberships, 'a', { a: { x: 10, y: 20 }, worker: { x: 400, y: 20 } }, runs)
  assert.equal(view.nodes.length, 5)
  assert.equal(view.nodes.find(node => node.id === 'unassigned')?.data.referenceLabel, '非默认成员')
  assert.equal(view.nodes.find(node => node.id === 'deleted')?.data.name, 'Former role')
  assert.equal(view.nodes.find(node => node.id === 'deleted')?.data.evidenceOnly, true)
  const analysis = view.nodes.find(node => node.data.runPurpose === 'review-analysis')!
  assert.equal(analysis.data.referenceLabel, '临时分析')
  assert.ok(analysis.id !== 'review-analysis')
  assert.ok(view.edges.some(edge => edge.target === analysis.id))
  assert.equal(memberships.length, 2)
  assert.deepEqual(view.nodes[0]?.position, { x: 10, y: 20 })
})
