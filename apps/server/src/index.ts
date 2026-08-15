import { createServer } from 'node:http'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createFlowStore } from './flow/store'
import { loadConfig } from './server/config'
import { createStaticHandler } from './server/http'
import { createRequestHandler } from './server/routes'
import { createSessionStore } from './server/sessions'
import { createSseHub } from './server/sse'
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
