import type { ChatMessage, FlowTopology } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { canAccessNode, createFlowStore, findConnection, listConnectedNodes } from './store'
import { formatFlowDirectory, searchMessages } from './tools'

it('persists topology without allowing topology updates to erase message history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-flow-'))
  const dataDir = join(root, 'data')
  const topology = fixtureTopology(root)

  try {
    const store = createFlowStore(dataDir)
    await store.replaceTopology(root, topology)
    await store.appendMessage(root, {
      id: 'message-1',
      edgeId: 'a-b',
      source: 'a',
      target: 'b',
      chainId: 'chain-1',
      hop: 1,
      preview: 'Please review this change',
      sentAt: new Date().toISOString(),
    })
    await store.replaceTopology(root, { ...topology, viewport: { x: 12, y: 24, zoom: 1.2 } })

    const restored = await createFlowStore(dataDir).read(root)
    assert.equal(restored.messages.length, 1)
    assert.deepEqual(restored.viewport, { x: 12, y: 24, zoom: 1.2 })
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('uses connections as symmetric discovery and context boundaries', () => {
  const document = {
    version: 1 as const,
    projectPath: '/project',
    messages: [],
    updatedAt: new Date().toISOString(),
    ...fixtureTopology('/project'),
  }

  assert.deepEqual(listConnectedNodes(document, 'a').map(node => node.id), ['b'])
  assert.deepEqual(listConnectedNodes(document, 'b').map(node => node.id), ['a'])
  assert.equal(canAccessNode(document, 'a', 'b'), true)
  assert.equal(canAccessNode(document, 'b', 'a'), true)
  assert.equal(canAccessNode(document, 'c', 'a'), false)
  assert.equal(findConnection(document, 'b', 'a')?.id, 'a-b')

  const directoryA = formatFlowDirectory(document, join('/project', 'a.jsonl'))
  assert.match(directoryA ?? '', /Peers:\n- b \| Module B/)
  assert.doesNotMatch(directoryA ?? '', /Isolated/)

  const directoryB = formatFlowDirectory(document, join('/project', 'b.jsonl'))
  assert.match(directoryB ?? '', /Peers:\n- a \| Module A/)
})

it('rejects a second edge between the same peers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-flow-'))
  const topology = fixtureTopology(root)

  try {
    const store = createFlowStore(join(root, 'data'))
    await assert.rejects(
      store.replaceTopology(root, {
        ...topology,
        edges: [
          ...topology.edges,
          { id: 'b-a', source: 'b', target: 'a', createdAt: new Date().toISOString() },
        ],
      }),
      /duplicate flow connection/,
    )
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('searches messages by exact text and returns newest matches first', () => {
  const messages: ChatMessage[] = [
    { role: 'user', content: 'Context corruption decision from yesterday' },
    { role: 'assistant', content: '上下文已经腐化' },
    { role: 'assistant', content: 'Context changed before unrelated corruption appeared' },
    { role: 'assistant', content: 'Latest CONTEXT CORRUPTION decision' },
  ]

  const results = searchMessages(messages, 'context corruption')

  assert.deepEqual(results.map(result => result.messageIndex), [3, 0])
  assert.equal('score' in results[0]!, false)
  assert.deepEqual(searchMessages(messages, '上下文已经').map(result => result.messageIndex), [1])
})

function fixtureTopology(root: string): FlowTopology {
  const now = new Date().toISOString()
  return {
    nodes: [
      { id: 'a', sessionPath: join(root, 'a.jsonl'), name: 'Module A', goal: '', position: { x: 0, y: 0 }, createdAt: now, updatedAt: now },
      { id: 'b', sessionPath: join(root, 'b.jsonl'), name: 'Module B', goal: '', position: { x: 400, y: 0 }, createdAt: now, updatedAt: now },
      { id: 'c', sessionPath: join(root, 'c.jsonl'), name: 'Isolated', goal: '', position: { x: 0, y: 300 }, createdAt: now, updatedAt: now },
    ],
    edges: [{ id: 'a-b', source: 'a', target: 'b', createdAt: now }],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}
