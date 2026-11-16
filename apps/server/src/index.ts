import process from 'node:process'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { build } from './app.ts'
import { createExtensionManager } from './extensions/manager.ts'
import { createFlowStore } from './flow/store.ts'
import { createProviderAuthManager } from './providers/provider-auth.ts'
import { createReviewGeneration } from './reviews/generation.ts'
import { createReviews } from './reviews/index.ts'
import { createSubagentRuns } from './runs/index.ts'
import { loadConfig } from './server/config.ts'
import { createSseHub } from './server/sse.ts'
import { createSessionStore } from './sessions/index.ts'
import { getUsage } from './usage/index.ts'

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
