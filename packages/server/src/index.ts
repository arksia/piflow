import { createServer } from 'node:http'
import process from 'node:process'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { loadConfig } from './core/config'
import { createStaticHandler } from './core/http'
import { createProviderAuthManager } from './core/provider-auth'
import { createRequestHandler } from './core/routes'
import { createSessionStore } from './core/sessions'
import { createSseHub } from './core/sse'
import { createExtensionManager } from './extensions/manager'
import { createFlowStore } from './flow/store'
import { getUsage } from './usage/index'

const config = loadConfig()
const sse = createSseHub(config.rootCwd)
const flow = createFlowStore(config.dataDir)
const extensions = createExtensionManager()
const modelRuntime = await ModelRuntime.create()
const providerAuth = createProviderAuthManager(modelRuntime, sse.broadcast)
const sessions = createSessionStore({
  rootCwd: config.rootCwd,
  flow,
  poolSize: config.sessionPoolSize,
  publish: sse.broadcast,
})
sse.setStatusSnapshotProvider(sessions.getStatusSnapshot)
sse.setStateSnapshotProvider(sessions.getStateSnapshot)
const serveStatic = createStaticHandler(config.webDist)
const httpServer = createServer(createRequestHandler({
  config,
  sessions,
  sse,
  serveStatic,
  getUsage,
  flow,
  extensions,
  modelRuntime,
  providerAuth,
}))

httpServer.listen(config.port, config.host, () => {
  console.info(`piflow · http://${config.host}:${config.port}`)
})

async function shutdown() {
  httpServer.close()
  await sessions.disposeAll()
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
