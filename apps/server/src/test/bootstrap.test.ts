import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { bootstrap } from '../bootstrap.ts'
import { openDatabase } from '../facts/database.ts'
import { loadConfig } from '../server/config.ts'

it('rolls back failed listen and closes idempotently without retaining the writer lease', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-bootstrap-'))
  const webDist = join(root, 'web')
  await mkdir(webDist)
  await writeFile(join(webDist, 'index.html'), 'test')
  const config = { ...loadConfig({ INIT_CWD: root, PIFLOW_DATA_DIR: join(root, 'one'), PORT: '0' }), webDist }
  const host = await bootstrap(config, { agentDir: join(root, 'agent') })
  try {
    const address = host.app.server.address()
    assert.ok(address && typeof address !== 'string')
    const second = { ...config, port: address.port, dataDir: join(root, 'two') }
    await assert.rejects(bootstrap(second, { agentDir: join(root, 'agent') }), /EADDRINUSE/)
    const db = await openDatabase(second.dataDir)
    db.close()
    await Promise.all([host.close(), host.close()])
    const reopened = await openDatabase(config.dataDir)
    reopened.close()
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(bootstrap(config, { signal: controller.signal }), { name: 'AbortError' })
  }
  finally {
    await host.close()
    await rm(root, { recursive: true, force: true })
  }
})
