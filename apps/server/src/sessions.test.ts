import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { persistEmptySession } from './server/sessions'

it('persists a new session before it has any messages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-session-'))
  const sessionDir = join(root, 'sessions')
  const manager = SessionManager.create(root, sessionDir)
  const path = manager.getSessionFile()
  assert.ok(path)

  try {
    await assert.rejects(access(path))
    await persistEmptySession(manager)

    const sessions = await SessionManager.list(root, sessionDir)
    assert.equal(sessions.length, 1)
    assert.equal(sessions[0]?.path, path)
    assert.equal(SessionManager.open(path).getCwd(), root)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})
