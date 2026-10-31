import type { FlowDocument, FlowNode } from '@piflow/protocol'
import assert from 'node:assert/strict'
import test from 'node:test'
import { addDraftNode, configureNode } from './node-forms'

function documentWith(...nodes: FlowNode[]): FlowDocument {
  return {
    version: 1,
    projectPath: '/project',
    nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    messages: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function node(id: string, kind: FlowNode['kind'] = 'persistent'): FlowNode {
  return {
    id,
    kind,
    sessionPath: `/sessions/${id}.jsonl`,
    name: id,
    goal: '',
    position: { x: 0, y: 0 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

test('addDraftNode normalizes text and omits sessions for subagent roles', () => {
  const document = documentWith()
  const next = addDraftNode(document, {
    id: 'role',
    kind: 'subagent-role',
    name: '  Reviewer  ',
    goal: '  Review changes  ',
    brief: '  Keep scope small  ',
    rolePrompt: '  Check edge cases  ',
    sessionPath: '/ignored.jsonl',
  }, '', { x: 32, y: 48 })

  assert.equal(next.nodes[0]?.name, 'Reviewer')
  assert.equal(next.nodes[0]?.goal, 'Review changes')
  assert.equal(next.nodes[0]?.brief, 'Keep scope small')
  assert.equal(next.nodes[0]?.rolePrompt, 'Check edge cases')
  assert.equal(next.nodes[0]?.sessionPath, '')
  assert.deepEqual(next.nodes[0]?.position, { x: 32, y: 48 })
  assert.equal(document.nodes.length, 0)
})

test('configureNode replaces only the configured orchestrator memberships', () => {
  const orchestrator = node('orchestrator')
  const firstRole = node('first-role', 'subagent-role')
  const secondRole = node('second-role', 'subagent-role')
  const document = documentWith(orchestrator, firstRole, secondRole)
  document.memberships = [{ orchestratorId: 'orchestrator', memberId: 'first-role' }]

  const next = configureNode(document, orchestrator.id, {
    kind: 'persistent',
    brief: '',
    roleLabel: '',
    rolePrompt: '',
    model: '',
    tools: [],
    orchestrationEnabled: true,
    memberIds: ['second-role'],
  })

  assert.deepEqual(next.memberships, [{ orchestratorId: 'orchestrator', memberId: 'second-role' }])
  assert.equal(next.nodes[0]?.orchestrationEnabled, true)
  assert.equal(document.memberships?.[0]?.memberId, 'first-role')
})

test('configureNode rejects changing a connected node into a subagent role', () => {
  const orchestrator = node('orchestrator')
  const peer = node('peer')
  const document = documentWith(orchestrator, peer)
  document.edges = [{ id: 'edge', source: orchestrator.id, target: peer.id, createdAt: '2026-01-01T00:00:00.000Z' }]

  assert.throws(() => configureNode(document, orchestrator.id, {
    kind: 'subagent-role',
    brief: '',
    roleLabel: '',
    rolePrompt: '',
    model: '',
    tools: [],
    orchestrationEnabled: false,
    memberIds: [],
  }), /请先移除该节点的通信边/)
})
