import assert from 'node:assert/strict'
import { it } from 'node:test'
import { memberPlacements } from './members'

it('projects independent expansions with shared references without changing authored positions', () => {
  const nodes = [
    { id: 'a', position: { x: 0, y: 0 } },
    { id: 'b', position: { x: 500, y: 0 } },
    { id: 'worker', position: { x: 900, y: 900 } },
  ]
  const before = structuredClone(nodes)
  const memberships = [{ orchestratorId: 'a', memberId: 'worker' }, { orchestratorId: 'b', memberId: 'worker' }]
  const expanded = memberPlacements(nodes, memberships, new Set(['a', 'b']), new Set())
  assert.equal(expanded.length, 2)
  assert.equal(expanded[0]?.id, 'worker')
  assert.equal(expanded[1]?.agentId, 'worker')
  assert.equal(expanded[1]?.reference, true)
  assert.notEqual(expanded[1]?.id, 'worker')
  assert.deepEqual(expanded[0]?.position, { x: 210 * Math.cos(-Math.PI / 4), y: 210 * Math.sin(-Math.PI / 4) })
  assert.deepEqual(nodes, before)
  assert.deepEqual(memberPlacements(nodes, memberships, new Set(), new Set()), [])
  assert.deepEqual(memberPlacements(nodes, memberships, new Set(['a']), new Set(['worker']))[0]?.position, nodes[2]?.position)
  assert.equal(memberPlacements(nodes.slice(0, 2), memberships, new Set(['a']), new Set()).length, 0)
})
