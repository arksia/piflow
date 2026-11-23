import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** A protocol emit is a barrier: both consumers stop before it and restart only after success. */
export async function startDevelopment({ root, commands, log = console.info }) {
  const children = new Map()
  const watchers = []
  let stopped = false
  let protocol = true
  let server = true
  let protocolReady = false
  let timer
  let updating
  let closing
  function launch(name) {
    const { args, cwd = root, env = {} } = commands[name]
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' })
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal }))
    })
    const entry = { child, exited, expected: name === 'build' }
    children.set(name, entry)
    void exited.then((result) => {
      if (children.get(name) === entry)
        children.delete(name)
      if (!entry.expected && !stopped) {
        console.error(`[dev] ${name} exited (${result.code ?? result.signal}); stopping development processes`)
        process.exitCode = 1
        void close()
      }
    }, (error) => {
      console.error(`[dev] cannot start ${name}`, error)
      process.exitCode = 1
      void close()
    })
    return entry
  }
  async function stop(name) {
    const entry = children.get(name)
    if (!entry)
      return
    entry.expected = true
    entry.child.kill('SIGTERM')
    // Host normally reaps workers itself; on forced exit workers also handle parent IPC loss.
    const deadline = setTimeout(() => entry.child.kill('SIGKILL'), 12000)
    try {
      await entry.exited
    }
    finally { clearTimeout(deadline) }
  }
  async function update() {
    while (protocol || server) {
      if (stopped)
        break
      const rebuild = protocol || !protocolReady
      protocol = false
      server = false
      log('[dev] Restarting Host; active development executions will be interrupted.')
      await stop('server')
      if (rebuild) {
        await stop('web')
        if (stopped)
          break
        protocolReady = false
        const result = await launch('build').exited
        if (result.code !== 0) {
          log('[dev] Protocol build failed; consumers remain stopped. Edit protocol sources to retry.')
          continue
        }
        protocolReady = true
      }
      // Changes received during compilation are built again before consumers can see dist.
      if (stopped || protocol)
        continue
      if (!children.has('web'))
        launch('web')
      launch('server')
    }
  }
  function schedule(isProtocol) {
    protocol ||= isProtocol
    server = true
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!updating) {
        updating = update().catch((error) => {
          console.error('[dev] restart failed', error)
          process.exitCode = 1
          void close()
        }).finally(() => { updating = undefined })
      }
    }, 100)
  }
  function signal() {
    void close()
  }
  function close() {
    if (closing)
      return closing
    stopped = true
    clearTimeout(timer)
    for (const watcher of watchers) watcher.close()
    process.removeListener('SIGINT', signal)
    process.removeListener('SIGTERM', signal)
    closing = (async () => {
      await Promise.all(['build', 'server', 'web'].map(stop))
      await updating
    })()
    return closing
  }
  process.on('SIGINT', signal)
  process.on('SIGTERM', signal)
  try {
    for (const [path, isProtocol] of [['apps/server/src', false], ['packages/protocol/src', true]]) {
      watchers.push(watch(join(root, path), { recursive: true }, (_event, filename) => {
        if (filename?.endsWith('.ts'))
          schedule(isProtocol)
      }))
    }
    updating = update()
    await updating
    updating = undefined
    return { close }
  }
  catch (error) {
    updating = undefined
    await close()
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const requireServer = createRequire(join(root, 'apps/server/package.json'))
  const requireWeb = createRequire(join(root, 'apps/web/package.json'))
  await startDevelopment({
    root,
    commands: {
      build: { args: [requireServer.resolve('typescript/lib/tsc.js'), '-p', join(root, 'packages/protocol/tsconfig.build.json')] },
      server: { args: ['--import', requireServer.resolve('tsx'), join(root, 'apps/server/src/index.ts'), '--no-open'], env: { PORT: '3141', HOST: '127.0.0.1' } },
      web: { args: [join(dirname(requireWeb.resolve('vite/package.json')), 'bin/vite.js'), '--strictPort'], cwd: join(root, 'apps/web') },
    },
  })
}
