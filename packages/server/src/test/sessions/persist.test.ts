import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { it } from 'node:test'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { createFlowStore } from '../../flow/store'
import { createSessionStore } from '../../sessions/index'

it('persists a session only after its first user message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-session-'))
  const agentDir = join(root, 'agent')
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = agentDir
  const sessions = createSessionStore({
    rootCwd: root,
    agentDir,
    flow: createFlowStore(join(root, 'data')),
    poolSize: 16,
    publish: () => {},
  })

  try {
    const managed = await sessions.createFreshSession(root)
    const path = managed.runtime.session.sessionManager.getSessionFile()
    assert.ok(path)
    assert.equal(existsSync(path), false)
    assert.deepEqual(await sessions.listSessions(), [])

    managed.runtime.session.sessionManager.appendMessage({ role: 'user', content: 'first message', timestamp: Date.now() })
    assert.equal(existsSync(path), true)
    assert.equal((await sessions.listSessions())[0]?.path, path)
    assert.equal(SessionManager.open(path).getCwd(), await realpath(root))
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
