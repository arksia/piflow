import process from 'node:process'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { build } from './app'
import { createExtensionManager } from './extensions/manager'
import { createFlowStore } from './flow/store'
import { createProviderAuthManager } from './providers/provider-auth'
import { loadConfig } from './server/config'
import { createSseHub } from './server/sse'
import { createSessionStore } from './sessions/index'
import { getUsage } from './usage/index'

const config = loadConfig()
const sse = createSseHub(config.rootCwd)
const flow = createFlowStore(config.dataDir)
const extensions = createExtensionManager()
const modelRuntime = await ModelRuntime.create()
const sessions = createSessionStore({
  rootCwd: config.rootCwd,
  flow,
  poolSize: config.sessionPoolSize,
  publish: sse.broadcast,
})
const providerAuth = createProviderAuthManager(modelRuntime, sse.broadcast, (providerId) => {
  void sessions.refreshProvider(providerId).catch(() => {})
})
sse.setStatusSnapshotProvider(sessions.getStatusSnapshot)
sse.setStateSnapshotProvider(sessions.getStateSnapshot)
const app = await build({
  config,
  sessions,
  sse,
  getUsage,
  flow,
  extensions,
  logger: true,
  modelRuntime,
  providerAuth,
})

await app.listen({ host: config.host, port: config.port })
console.info(`piflow · http://${config.host}:${config.port}`)

async function shutdown() {
  await app.close()
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
