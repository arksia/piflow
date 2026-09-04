import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { it } from 'node:test'
import { createFlowStore } from '../flow/store'
import { createSessionStore } from './sessions'

it('deduplicates activation and only evicts safe idle runtimes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-runtime-'))
  const agentDir = join(root, 'agent')
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = agentDir

  try {
    const first = createSessionStore({
      rootCwd: root,
      flow: createFlowStore(join(root, 'data')),
      poolSize: 16,
      publish: () => {},
    })
    const seed = await first.createFreshSession(root, true)
    const path = seed.runtime.session.sessionFile
    assert.ok(path)
    await first.disposeAll()

    const concurrent = createSessionStore({
      rootCwd: root,
      flow: createFlowStore(join(root, 'data')),
      poolSize: 16,
      publish: () => {},
    })
    const [left, right] = await Promise.all([
      concurrent.openSavedSession(path),
      concurrent.openSavedSession(path),
    ])
    assert.strictEqual(left, right)
    await concurrent.disposeAll()

    const limited = createSessionStore({
      rootCwd: root,
      flow: createFlowStore(join(root, 'data')),
      poolSize: 1,
      publish: () => {},
    })
    const oldest = await limited.openSavedSession(path)
    assert.ok(oldest)
    const pending = oldest.extensionUi.confirm('Confirm', 'Keep this runtime')
    const newest = await limited.createFreshSession(root, true)
    const newestPath = newest.runtime.session.sessionFile
    assert.ok(newestPath)
    assert.strictEqual(limited.get(path), oldest)
    assert.strictEqual(limited.get(newestPath), newest)

    const request = oldest.extensionUi.snapshot().find(item => item.method === 'confirm')
    assert.ok(request)
    oldest.extensionUi.respond({ type: 'extension_ui_response', id: request.id, confirmed: false })
    await pending
    await limited.disposeAll()

    await mkdir(join(root, '.pi'), { recursive: true })
    await writeFile(join(root, '.pi', 'SYSTEM.md'), 'project instructions')
    const trust = createSessionStore({
      rootCwd: root,
      flow: createFlowStore(join(root, 'data')),
      poolSize: 1,
      publish: () => {},
    })
    assert.deepEqual(trust.getProjectTrust(root), { cwd: root, requiresTrust: true, trusted: false })
    assert.equal((await trust.trustProject(root)).trusted, true)
    await trust.disposeAll()
  }
  finally {
    if (previousAgentDir === undefined)
      delete process.env.PI_CODING_AGENT_DIR
    else
      process.env.PI_CODING_AGENT_DIR = previousAgentDir
    await rm(root, { recursive: true, force: true })
  }
})
