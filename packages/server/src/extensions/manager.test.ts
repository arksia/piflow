import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { DefaultPackageManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import { createExtensionManager } from './manager'

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'piflow-extensions-'))
  const cwd = join(root, 'project')
  const agentDir = join(root, 'agent')
  mkdirSync(cwd, { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  after(() => rmSync(root, { recursive: true, force: true }))
  return { cwd, agentDir }
}

async function seedPackage(cwd: string, agentDir: string, source: string, local?: boolean) {
  const settingsManager = SettingsManager.create(cwd, agentDir)
  const seeder = new DefaultPackageManager({ cwd, agentDir, settingsManager })
  assert.equal(seeder.addSourceToSettings(source, { local }), true)
  // Writes are enqueued asynchronously; flush before another manager reads.
  await settingsManager.flush()
}

describe('extension manager', () => {
  it('lists nothing when no packages are configured', () => {
    const { cwd, agentDir } = createFixture()
    assert.deepEqual(createExtensionManager(cwd, agentDir).list(), [])
  })

  it('maps configured packages to source info with scope', async () => {
    const { cwd, agentDir } = createFixture()
    // Seed settings before creating the manager so its SettingsManager reads them.
    await seedPackage(cwd, agentDir, 'npm:@foo/bar')
    await seedPackage(cwd, agentDir, 'npm:@foo/baz', true)

    const extensions = createExtensionManager(cwd, agentDir).list()
    assert.equal(extensions.length, 2)

    const userScoped = extensions.find(extension => extension.scope === 'user')
    const projectScoped = extensions.find(extension => extension.scope === 'project')
    assert.ok(userScoped)
    assert.ok(projectScoped)
    assert.match(userScoped.source, /@foo\/bar/)
    assert.match(projectScoped.source, /@foo\/baz/)
    assert.equal(userScoped.filtered, false)
  })
})
