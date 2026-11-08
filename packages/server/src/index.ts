import process from 'node:process'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { build } from './app'
import { createExtensionManager } from './extensions/manager'
import { createFlowStore } from './flow/store'
import { createProviderAuthManager } from './providers/provider-auth'
import { createReviews } from './reviews'
import { createReviewGeneration } from './reviews/generation'
import { createSubagentRuns } from './runs'
import { loadConfig } from './server/config'
import { createSseHub } from './server/sse'
import { createSessionStore } from './sessions/index'
import { getUsage } from './usage/index'

const config = loadConfig()
const sse = createSseHub(config.rootCwd)
const flow = createFlowStore(config.dataDir)
const reviews = await createReviews({ dataDir: config.dataDir, publish: sse.broadcast })
const runs = await createSubagentRuns({ dataDir: config.dataDir, publish: sse.broadcast, reviews })
const reviewGeneration = createReviewGeneration(reviews, runs)
const extensions = createExtensionManager()
const modelRuntime = await ModelRuntime.create()
const sessions = createSessionStore({
  rootCwd: config.rootCwd,
  runs,
  reviews,
  reviewGeneration,
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
  runs,
  reviews,
  reviewGeneration,
  extensions,
  logger: true,
  modelRuntime,
  providerAuth,
})

await app.listen({ host: config.host, port: config.port })
console.info(`piflow · http://${config.host}:${config.port}`)

async function shutdown() {
  await reviewGeneration.close()
  await runs.close()
  reviews.close()
  await sessions.disposeAll()
  await app.close()
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
