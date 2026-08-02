import { createServer } from 'node:http'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { loadConfig } from './server/config.js'
import { createStaticHandler } from './server/http.js'
import { createRequestHandler } from './server/routes.js'
import { createSessionStore } from './server/sessions.js'
import { createSseHub } from './server/sse.js'
import { getUsage } from './usage/index.js'

const config = loadConfig()
const modelRuntime = await ModelRuntime.create()
const sse = createSseHub(config.rootCwd)
const sessions = createSessionStore({
  rootCwd: config.rootCwd,
  modelRuntime,
  publish: sse.broadcast,
})
const serveStatic = createStaticHandler(config.webDist)
const httpServer = createServer(createRequestHandler({
  config,
  sessions,
  sse,
  serveStatic,
  getUsage,
}))

httpServer.listen(config.port, config.host, () => {
  console.info(`piflow · http://${config.host}:${config.port}`)
})
