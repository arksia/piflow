import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { it } from 'node:test'
import { createFlowStore } from '../flow/store'
import { createSessionStore } from './sessions'

it('uses native streaming behavior and queue semantics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-queue-'))
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent')
  const sessions = createSessionStore({
    rootCwd: root,
    flow: createFlowStore(join(root, 'data')),
    poolSize: 16,
    publish: () => {},
  })

  try {
    const managed = await sessions.createFreshSession(root, true)
    const calls: unknown[] = []
    managed.runtime.session.prompt = async (_text, options) => {
      calls.push(options?.streamingBehavior)
    }
    await sessions.prompt(managed, 'now', undefined, 'steer')
    await sessions.prompt(managed, 'later', undefined, 'followUp')
    assert.deepEqual(calls, ['steer', 'followUp'])

    await managed.runtime.session.steer('steering message')
    await managed.runtime.session.followUp('follow-up message')
    await managed.runtime.session.abort()
    assert.deepEqual(sessions.getState(managed).queue, {
      steering: ['steering message'],
      followUp: ['follow-up message'],
    })
    assert.deepEqual(managed.runtime.session.clearQueue(), {
      steering: ['steering message'],
      followUp: ['follow-up message'],
    })
    assert.deepEqual(sessions.getState(managed).queue, { steering: [], followUp: [] })
  }
  finally {
    await sessions.disposeAll()
    if (previousAgentDir === undefined)
      delete process.env.PI_CODING_AGENT_DIR
    else
      process.env.PI_CODING_AGENT_DIR = previousAgentDir
    await rm(root, { recursive: true, force: true })
  }
})
