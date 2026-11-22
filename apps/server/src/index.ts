import process from 'node:process'
import { bootstrap } from './bootstrap.ts'
import { loadConfig } from './server/config.ts'

const controller = new AbortController()
const stop = () => controller.abort()
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
try {
  const host = await bootstrap(loadConfig(), { signal: controller.signal, logger: true })
  console.info(`piflow · ${host.address}`)
}
catch (error) {
  if (!controller.signal.aborted) {
    console.error('[piflow] startup failed', error)
    process.exitCode = 1
  }
  process.removeListener('SIGINT', stop)
  process.removeListener('SIGTERM', stop)
}
