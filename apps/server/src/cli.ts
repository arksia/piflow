import type { AppResources } from './distribution/resources.ts'
import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { parseArgs, promisify } from 'node:util'
import { loadConfig } from './server/config.ts'

const help = `Usage: piflow [project] [options]

  --no-open      Start without opening a browser
  --port <port>  Listen on this port (0 chooses an available port)
  --host <host>  Bind address (default: 127.0.0.1)
  -h, --help     Show help
  -v, --version  Show application and pi versions
`

export function parseCli(args: string[], env = process.env) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'no-open': { type: 'boolean' },
      'port': { type: 'string' },
      'host': { type: 'string' },
      'help': { type: 'boolean', short: 'h' },
      'version': { type: 'boolean', short: 'v' },
    },
  })
  if (positionals.length > 1)
    throw new Error('Specify at most one project directory')
  return {
    ...values,
    project: resolve(positionals[0] ?? process.cwd()),
    explicitPort: values.port !== undefined || env.PORT !== undefined,
    open: !values['no-open'] && !env.SSH_CONNECTION && !env.SSH_TTY
      && (process.platform !== 'linux' || Boolean(env.DISPLAY || env.WAYLAND_DISPLAY)),
  }
}

async function openBrowser(url: string) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open'
  await promisify(execFile)(command, process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url], { timeout: 10000 })
}

/** CLI owns OS signals and browser opening; bootstrap owns all application resources. */
export async function runCli(args: string[], resources: AppResources, options: { env?: NodeJS.ProcessEnv, openBrowser?: (url: string) => Promise<void> } = {}) {
  const env = options.env ?? process.env
  const parsed = parseCli(args, env)
  if (parsed.help) {
    console.info(help)
    return
  }
  if (parsed.version) {
    console.info(`piflow ${resources.version} (pi ${resources.piVersion})`)
    return
  }
  if (!(await stat(parsed.project)).isDirectory())
    throw new Error('Project must be a directory')
  const config = loadConfig({ ...env, PORT: parsed.port ?? env.PORT, HOST: parsed.host ?? env.HOST }, { rootCwd: parsed.project, webDist: resources.webDist })
  const controller = new AbortController()
  let host: Awaited<ReturnType<typeof import('./bootstrap.ts').bootstrap>> | undefined
  function removeSignals() {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
  async function close() {
    try {
      await host?.close()
    }
    finally { removeSignals() }
  }
  function stop() {
    controller.abort()
    if (host) {
      void close().catch((error) => {
        console.error('[piflow] shutdown failed', error)
        process.exitCode = 1
      })
    }
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  try {
    const { bootstrap } = await import('./bootstrap.ts')
    const start = (port: number) => bootstrap({ ...config, port }, {
      signal: controller.signal,
      agentDir: env.PI_CODING_AGENT_DIR,
      worker: { entry: resources.workerEntry },
      extensions: resources.extensions,
    })
    try {
      host = await start(config.port)
    }
    catch (error) {
      if (!parsed.explicitPort && error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE')
        host = await start(0)
      else throw error
    }
    controller.signal.throwIfAborted()
    const authenticated = await host.app.inject({ method: 'GET', url: '/auth' })
    const cookie = String(authenticated.headers['set-cookie']).split(';')[0]!
    const hello = await host.app.inject({ method: 'GET', url: '/api/hello', headers: { cookie } })
    if (authenticated.statusCode !== 204 || hello.statusCode !== 200)
      throw new Error('Host authentication readiness check failed')
    controller.signal.throwIfAborted()
    console.info(`piflow · ${host.address}`)
    if (parsed.open && config.isLoopback) {
      try {
        await (options.openBrowser ?? openBrowser)(host.address)
      }
      catch { console.warn('[piflow] Could not open a browser; open the address above.') }
    }
    return { ...host, close }
  }
  catch (error) {
    await close()
    if (!controller.signal.aborted)
      throw error
  }
}
