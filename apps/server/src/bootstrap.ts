import type { ServerConfig } from './server/config.ts'
import { join } from 'node:path'
import { getAgentDir, ModelRuntime } from '@earendil-works/pi-coding-agent'
import { build } from './app.ts'
import { createExtensionManager } from './extensions/manager.ts'
import { openDatabase } from './facts/database.ts'
import { createFactsStore } from './facts/store.ts'
import { createFlowStore } from './flow/store.ts'
import { createProviderAuthManager } from './providers/provider-auth.ts'
import { createReviewGeneration } from './reviews/generation.ts'
import { createReviews } from './reviews/index.ts'
import { createSubagentRuns } from './runs/index.ts'
import { createProjectRuntime } from './runtime/index.ts'
import { createSseHub } from './server/sse.ts'
import { createSessionStore } from './sessions/index.ts'
import { getUsage } from './usage/index.ts'

/** Own all host resources, including startup rollback. The caller owns OS signals. */
export async function bootstrap(config: ServerConfig, options: {
  signal?: AbortSignal
  logger?: boolean
  agentDir?: string
  extensions?: { delivery: string, review: string }
  worker?: Pick<Parameters<typeof createProjectRuntime>[0], 'entry' | 'startTimeoutMs' | 'stopTimeoutMs'>
} = {}) {
  const cleanup: Array<() => void | Promise<void>> = []
  let closePromise: Promise<void> | undefined
  let app: Awaited<ReturnType<typeof build>> | undefined
  let closing = false
  let releaseDatabase: (() => void) | undefined
  function check() {
    options.signal?.throwIfAborted()
  }
  async function release() {
    const failures: unknown[] = []
    for (const dispose of cleanup.reverse()) {
      // The database lease is last. Keep it if any owned resource failed to stop.
      if (dispose === releaseDatabase && failures.length)
        continue
      try {
        await dispose()
      }
      catch (error) { failures.push(error) }
    }
    if (failures.length)
      throw new AggregateError(failures, 'Host cleanup failed')
  }
  function close() {
    closing = true
    closePromise ??= (async () => {
      options.signal?.removeEventListener('abort', onAbort)
      await release()
    })()
    return closePromise
  }
  function onAbort() {
    void close().catch(error => console.error('[piflow] shutdown failed', error))
  }
  try {
    check()
    const database = await openDatabase(config.dataDir)
    releaseDatabase = () => database.close()
    cleanup.push(releaseDatabase)
    check()
    const agentDir = options.agentDir ?? getAgentDir()
    const facts = createFactsStore(database)
    facts.recover()
    const sse = createSseHub(config.rootCwd)
    cleanup.push(() => sse.close())
    const flow = createFlowStore(config.dataDir)
    const reviews = await createReviews({ dataDir: config.dataDir, publish: sse.broadcast })
    cleanup.push(() => reviews.close())
    check()
    const runs = await createSubagentRuns({ database, dataDir: config.dataDir, publish: sse.broadcast, reviews, extensionPaths: options.extensions })
    cleanup.push(() => runs.close())
    check()
    const reviewGeneration = createReviewGeneration(reviews, runs)
    cleanup.push(() => reviewGeneration.close())
    const extensions = createExtensionManager()
    const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), modelsStorePath: join(agentDir, 'models-cache.json'), signal: options.signal })
    check()
    const sessions = createSessionStore({
      facts,
      agentDir,
      rootCwd: config.rootCwd,
      runs,
      reviews,
      reviewGeneration,
      flow,
      poolSize: config.sessionPoolSize,
      publish: sse.broadcast,
    })
    cleanup.push(() => sessions.disposeAll())
    const runtime = createProjectRuntime({ ...options.worker, facts, dataDir: config.dataDir, agentDir })
    cleanup.push(() => runtime.close())
    const providerAuth = createProviderAuthManager(modelRuntime, sse.broadcast, (providerId) => {
      void sessions.refreshProvider(providerId).catch(error => sessions.publishError('', String(error)))
    })
    sse.setStatusSnapshotProvider(sessions.getStatusSnapshot)
    sse.setStateSnapshotProvider(sessions.getStateSnapshot)
    app = await build({ config, facts, runtime, sessions, sse, getUsage, flow, runs, reviews, reviewGeneration, extensions, logger: options.logger ?? false, modelRuntime, providerAuth })
    cleanup.push(() => app!.close())
    // Stop workers before HTTP drain: a control may itself be awaiting an unresponsive worker.
    app.addHook('preClose', async () => runtime.close())
    app.addHook('onRequest', async (_request, reply) => {
      if (closing)
        return reply.code(503).send({ error: 'Host is closing' })
    })
    check()
    const address = await app.listen({ host: config.host, port: config.port })
    check()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    return { app, address, runtime, close }
  }
  catch (error) {
    try {
      await close()
    }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Host startup and cleanup failed') }
    throw error
  }
}
