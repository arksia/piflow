import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { persistBranchedSession, userMessageText } from './core/sessions'

interface FixtureEntry {
  id: string
  role: 'user' | 'assistant'
  content: string
}

async function createSessionFile(root: string, entries: FixtureEntry[]) {
  const sessionDir = join(root, 'sessions')
  const file = join(sessionDir, 'session.jsonl')
  const header = {
    type: 'session',
    version: 3,
    id: 'session-1',
    timestamp: new Date().toISOString(),
    cwd: root,
  }
  const lines = [JSON.stringify(header)]
  let parentId: string | null = null
  for (const entry of entries) {
    lines.push(JSON.stringify({
      type: 'message',
      id: entry.id,
      parentId,
      timestamp: new Date().toISOString(),
      message: { role: entry.role, content: entry.content },
    }))
    parentId = entry.id
  }
  await mkdir(sessionDir, { recursive: true })
  await writeFile(file, `${lines.join('\n')}\n`)
  return file
}

it('extracts text from user message entries for fork points', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-manage-'))

  try {
    const file = await createSessionFile(root, [
      { id: 'u1', role: 'user', content: 'first\nquestion   with gaps' },
      { id: 'a1', role: 'assistant', content: 'answer' },
      { id: 'u2', role: 'user', content: 'second question' },
    ])
    const entries = SessionManager.open(file).getEntries()

    assert.deepEqual(entries.map(entry => userMessageText(entry)), [
      'first question with gaps',
      null,
      'second question',
    ])
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('returns null for non-message entries and non-user roles', () => {
  assert.equal(userMessageText({
    type: 'model_change',
    id: 'm1',
    parentId: null,
    timestamp: new Date().toISOString(),
    provider: 'p',
    modelId: 'm',
  }), null)
})

it('renames a closed session by appending a session_info entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-manage-'))

  try {
    const file = await createSessionFile(root, [
      { id: 'u1', role: 'user', content: 'hello' },
      { id: 'a1', role: 'assistant', content: 'hi' },
    ])

    assert.equal(SessionManager.open(file).getSessionName(), undefined)
    SessionManager.open(file).appendSessionInfo('重要会话')
    assert.equal(SessionManager.open(file).getSessionName(), '重要会话')
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('forks a session into a new file containing only the path to the chosen entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-manage-'))

  try {
    const file = await createSessionFile(root, [
      { id: 'u1', role: 'user', content: 'first' },
      { id: 'a1', role: 'assistant', content: 'one' },
      { id: 'u2', role: 'user', content: 'second' },
      { id: 'a2', role: 'assistant', content: 'two' },
    ])

    const branched = SessionManager.open(file).createBranchedSession('a1')
    assert.ok(branched)

    const fork = SessionManager.open(branched)
    assert.deepEqual(fork.getEntries().map(entry => entry.id), ['u1', 'a1'])
    assert.equal(fork.getHeader()?.parentSession, file)
    assert.equal(fork.getCwd(), root)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('throws when forking from an unknown entry id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-manage-'))

  try {
    const file = await createSessionFile(root, [
      { id: 'u1', role: 'user', content: 'first' },
      { id: 'a1', role: 'assistant', content: 'one' },
    ])

    assert.throws(() => SessionManager.open(file).createBranchedSession('nope'), /not found/i)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('persists a branched session without assistant messages so listAll exposes its parent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-manage-'))

  try {
    const file = await createSessionFile(root, [
      { id: 'u1', role: 'user', content: 'first' },
      { id: 'a1', role: 'assistant', content: 'one' },
    ])
    const manager = SessionManager.open(file)
    const branched = manager.createBranchedSession('u1')
    assert.ok(branched)
    // The SDK defers writing a branch whose path has no assistant message.
    assert.equal(existsSync(branched), false)

    await persistBranchedSession(manager, branched)

    const all = await SessionManager.listAll(join(root, 'sessions'))
    assert.equal(all.find(session => session.path === branched)?.parentSessionPath, file)
    assert.equal(all.find(session => session.path === file)?.parentSessionPath, undefined)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})
