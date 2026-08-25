import { createServer } from 'node:http'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { loadConfig } from './core/config'
import { createStaticHandler } from './core/http'
import { createRequestHandler } from './core/routes'
import { createSessionStore } from './core/sessions'
import { createSseHub } from './core/sse'
import { createFlowStore } from './flow/store'
import { getUsage } from './usage/index'

const config = loadConfig()
const modelRuntime = await ModelRuntime.create()
const sse = createSseHub(config.rootCwd)
const flow = createFlowStore(config.dataDir)
const sessions = createSessionStore({
  rootCwd: config.rootCwd,
  modelRuntime,
  flow,
  publish: sse.broadcast,
})
sse.setStatusSnapshotProvider(sessions.getStatusSnapshot)
const serveStatic = createStaticHandler(config.webDist)
const httpServer = createServer(createRequestHandler({
  config,
  sessions,
  sse,
  serveStatic,
  getUsage,
  flow,
}))

httpServer.listen(config.port, config.host, () => {
  console.info(`piflow · http://${config.host}:${config.port}`)
})
