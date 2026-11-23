import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { it } from 'node:test'
import { parseCli, runCli } from '../cli.ts'
import { developmentResources } from '../distribution/resources.ts'
import { openDatabase } from '../facts/database.ts'
import { loadConfig } from '../server/config.ts'

it('parses CLI intent without taking the project from package-manager environment', async () => {
  assert.equal(parseCli([], { INIT_CWD: '/unrelated' }).project, process.cwd())
  assert.equal(parseCli(['--no-open'], {}).open, false)
  assert.equal(parseCli([], { SSH_TTY: '/dev/test' }).open, false)
  assert.equal(parseCli(['--port', '0'], {}).explicitPort, true)
  assert.equal(parseCli([], { PORT: '3141' }).explicitPort, true)
  assert.throws(() => parseCli(['one', 'two']), /one project/)
  assert.throws(() => parseCli(['--invalid']), /Unknown option/)
  for (const port of ['abc', '-1', '1.5', '65536'])
    assert.throws(() => loadConfig({ PORT: port }), /PORT must/)
  const source = await developmentResources(new URL('../index.ts', import.meta.url))
  const built = await developmentResources(new URL('../index.js', import.meta.url))
  assert.match(source.workerEntry.pathname, /runtime\/worker.ts$/)
  assert.match(built.workerEntry.pathname, /runtime\/worker.js$/)
  assert.match(built.extensions.delivery, /code-delivery-extension.js$/)
  assert.match(source.version, /^\d+\.\d+/)
})

it('opens the browser only after authenticated readiness and releases failed-start ownership', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-cli-')))
  const webDist = join(root, 'web')
  await mkdir(webDist)
  await writeFile(join(webDist, 'index.html'), 'cli web')
  const resources = { ...await developmentResources(new URL('../index.ts', import.meta.url)), webDist }
  const env = { PIFLOW_DATA_DIR: join(root, 'data'), PI_CODING_AGENT_DIR: join(root, 'agent'), DISPLAY: ':test', INIT_CWD: '/unrelated' }
  await import('../bootstrap.ts')
  const signals = process.listenerCount('SIGINT')
  let opened = 0
  let ready = false
  const openBrowser = async (address: string) => {
    opened++
    const authenticated = await fetch(`${address}/auth`)
    assert.equal(authenticated.status, 204)
    const cookie = authenticated.headers.get('set-cookie')!.split(';')[0]!
    const hello = await fetch(`${address}/api/hello`, { headers: { cookie } })
    assert.equal((await hello.json() as { cwd: string }).cwd, root)
    assert.equal(await (await fetch(address)).text(), 'cli web')
    ready = true
  }
  try {
    const host = await runCli([root, '--port', '0'], resources, { env, openBrowser })
    assert.ok(host)
    await host.close()
    assert.equal(opened, 1)
    assert.equal(ready, true)
    assert.equal(process.listenerCount('SIGINT'), signals)
    const headless = await runCli([root, '--port', '0', '--no-open'], resources, { env, openBrowser })
    assert.ok(headless)
    await headless.close()
    assert.equal(opened, 1)
    const occupied = createServer()
    await new Promise<void>(resolve => occupied.listen(0, '127.0.0.1', resolve))
    try {
      const address = occupied.address()
      assert.ok(address && typeof address !== 'string')
      await assert.rejects(runCli([root, '--port', String(address.port), '--no-open'], resources, { env }), { code: 'EADDRINUSE' })
      const db = await openDatabase(env.PIFLOW_DATA_DIR)
      db.close()
      assert.equal(process.listenerCount('SIGINT'), signals)
    }
    finally { await new Promise<void>(resolve => occupied.close(() => resolve())) }
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
