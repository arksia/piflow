import type { FlowTopology } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { canReadNode, createFlowStore, listOutboundNodes } from './flow/store'
import { formatFlowDirectory } from './flow/tools'

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

it('uses directed edges as discovery and context-read boundaries', () => {
  const document = {
    version: 1 as const,
    projectPath: '/project',
    messages: [],
    updatedAt: new Date().toISOString(),
    ...fixtureTopology('/project'),
  }

  assert.deepEqual(listOutboundNodes(document, 'a').map(node => node.id), ['b'])
  assert.deepEqual(listOutboundNodes(document, 'b'), [])
  assert.equal(canReadNode(document, 'b', 'a'), true)
  assert.equal(canReadNode(document, 'a', 'b'), false)
  assert.equal(canReadNode(document, 'c', 'a'), false)

  const directoryA = formatFlowDirectory(document, '/project/a.jsonl')
  assert.match(directoryA ?? '', /Outgoing:\n- b \| Module B/)
  assert.doesNotMatch(directoryA ?? '', /Isolated/)

  const directoryB = formatFlowDirectory(document, '/project/b.jsonl')
  assert.match(directoryB ?? '', /Incoming:\n- a \| Module A/)
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
