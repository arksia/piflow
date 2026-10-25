import type { FlowNode } from '@piflow/protocol'
import type { DeliverySession } from '../../flow/delivery'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { createDeliveries } from '../../flow/delivery'
import { createFlowStore } from '../../flow/store'

it('returns queued without prompting when the target is busy or missing', async () => {
  const harness = await createHarness()
  try {
    harness.sessions.get('b')!.streaming = true
    const busy = await harness.deliveries.send(harness.projectPath, harness.sessionPath('a'), 'b', 'first')
    assert.match(busy, /Queued for Module B/)
    assert.equal(harness.sessions.get('b')!.prompts.length, 0)

    const missing = await harness.deliveries.send(harness.projectPath, harness.sessionPath('a'), 'c', 'no')
    assert.match(missing, /Queued for Isolated/)
    const saved = await harness.store.read(harness.projectPath)
    assert.deepEqual(saved.messages.map(message => message.status), ['queued', 'queued'])
  }
  finally {
    await harness.cleanup()
  }
})

it('delivers the oldest waiting entry once the target is idle', async () => {
  const harness = await createHarness()
  try {
    harness.sessions.get('b')!.streaming = true
    await harness.deliveries.send(harness.projectPath, harness.sessionPath('a'), 'b', 'first body')
    await harness.deliveries.send(harness.projectPath, harness.sessionPath('a'), 'b', 'second body')
    harness.sessions.get('b')!.streaming = false
    const third = await harness.deliveries.send(harness.projectPath, harness.sessionPath('a'), 'b', 'third body')
    assert.match(third, /Queued for Module B/)
    const prompts = harness.sessions.get('b')!.prompts
    assert.equal(prompts.length, 1)
    assert.equal(prompts[0]?.followUp, false)
    assert.match(prompts[0]?.text ?? '', /first body/)
    assert.doesNotMatch(prompts[0]?.text ?? '', /third body|piflow:chain/)
    const saved = await harness.store.read(harness.projectPath)
    assert.equal(saved.messages[0]?.status, 'delivered')
    assert.equal(saved.messages[0]?.read, true)
    assert.equal(saved.messages[1]?.status, 'queued')
    assert.equal(saved.messages[2]?.status, 'queued')
  }
  finally {
    await harness.cleanup()
  }
})

it('reports a failure from the tool result when the prompt throws immediately', async () => {
  const harness = await createHarness()
  try {
    harness.sessions.get('b')!.fail = 'sync'
    const result = await harness.deliveries.send(harness.projectPath, harness.sessionPath('a'), 'b', 'hello')
    assert.match(result, /failed/)
    assert.equal(harness.sessions.get('a')!.prompts.length, 0)
    const saved = await harness.store.read(harness.projectPath)
    assert.equal(saved.messages[0]?.status, 'failed')
  }
  finally {
    await harness.cleanup()
  }
})

it('wakes the sender once when a delivered run fails later', async () => {
  const harness = await createHarness()
  try {
    harness.sessions.get('a')!.streaming = true
    harness.sessions.get('b')!.fail = 'async'
    const result = await harness.deliveries.send(harness.projectPath, harness.sessionPath('a'), 'b', 'hello')
    assert.match(result, /Delivered to Module B/)
    await waitFor(async () => harness.sessions.get('a')!.prompts.length === 1)
    const wakes = harness.sessions.get('a')!.prompts
    assert.equal(wakes.length, 1)
    assert.equal(wakes[0]?.followUp, true)
    assert.match(wakes[0]?.text ?? '', /failed: boom/)
    const saved = await harness.store.read(harness.projectPath)
    assert.equal(saved.messages.length, 1)
  }
  finally {
    await harness.cleanup()
  }
})

it('refuses a peer that is not connected', async () => {
  const harness = await createHarness()
  try {
    await assert.rejects(
      harness.deliveries.send(harness.projectPath, harness.sessionPath('a'), 'missing', 'hello'),
      /not a connected Flow peer/,
    )
    assert.equal((await harness.store.read(harness.projectPath)).messages.length, 0)
  }
  finally {
    await harness.cleanup()
  }
})

interface SessionState {
  streaming: boolean
  fail?: 'sync' | 'async'
  prompts: Array<{ text: string, followUp: boolean }>
}

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), 'piflow-delivery-'))
  const store = createFlowStore(join(root, 'data'))
  const now = new Date().toISOString()
  const node = (id: string, name: string): FlowNode => ({
    id,
    sessionPath: join(root, `${id}.jsonl`),
    name,
    goal: '',
    position: { x: 0, y: 0 },
    createdAt: now,
    updatedAt: now,
  })
  await store.replaceTopology(root, {
    nodes: [node('a', 'Module A'), node('b', 'Module B'), node('c', 'Isolated')],
    edges: [
      { id: 'a-b', source: 'a', target: 'b', createdAt: now },
      { id: 'a-c', source: 'a', target: 'c', createdAt: now },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  }, { commitGraph: true })
  const projectPath = (await store.read(root)).projectPath
  const sessions = new Map<string, SessionState>([
    ['a', { streaming: false, prompts: [] }],
    ['b', { streaming: false, prompts: [] }],
  ])
  const deliveries = createDeliveries(store, async (target) => {
    const state = sessions.get(target.id)
    if (!state)
      return null
    const session: DeliverySession = {
      get isStreaming() {
        return state.streaming
      },
      prompt(text, followUp) {
        state.prompts.push({ text, followUp })
        if (state.fail === 'sync')
          throw new Error('boom')
        if (state.fail === 'async')
          return Promise.reject(new Error('boom'))
        return Promise.resolve()
      },
    }
    return session
  })
  return {
    store,
    deliveries,
    projectPath,
    sessions,
    sessionPath: (id: string) => join(root, `${id}.jsonl`),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

async function waitFor(ready: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await ready())
      return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('timed out')
}
