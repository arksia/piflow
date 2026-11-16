import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { HelloResponse } from '@piflow/protocol'
import type { FastifyServerOptions } from 'fastify'
import type { ExtensionManager } from './extensions/manager.ts'
import type { FlowStore } from './flow/store.ts'
import type { ProviderAuthManager } from './providers/provider-auth.ts'
import type { ReviewGeneration } from './reviews/generation.ts'
import type { Reviews } from './reviews/index.ts'
import type { UsageSnapshot } from './routes/usage.ts'
import type { SubagentRuns } from './runs/index.ts'
import type { ServerConfig } from './server/config.ts'
import type { SseHub } from './server/sse.ts'
import type { SessionStore } from './sessions/index.ts'
import { fastifySSE as fastifySse } from '@fastify/sse'
import fastifyStatic from '@fastify/static'
import { API_EVENTS_PATH, API_HELLO_PATH } from '@piflow/protocol'
import Fastify from 'fastify'
import { httpAuth } from './plugins/auth.ts'
import { ProviderAuthBusyError } from './providers/provider-auth.ts'
import { extensionRoutes } from './routes/extensions.ts'
import { flowActivityRoutes } from './routes/flow-activity.ts'
import { flowRoutes } from './routes/flow.ts'
import { projectRoutes } from './routes/project.ts'
import { providerRoutes } from './routes/providers.ts'
import { reviewRoutes } from './routes/reviews.ts'
import { runRoutes } from './routes/runs.ts'
import { sessionRoutes } from './routes/sessions.ts'
import { submissionRoutes } from './routes/submissions.ts'
import { usageRoutes } from './routes/usage.ts'
import { send } from './server/reply.ts'
import { SessionsStreamingError } from './sessions/index.ts'

interface CreateAppOptions {
  runs: SubagentRuns
  reviews?: Reviews
  reviewGeneration?: ReviewGeneration
  config: ServerConfig
  sessions: SessionStore
  sse: SseHub
  getUsage: (provider: string, fresh?: boolean) => Promise<UsageSnapshot | null>
  flow: FlowStore
  extensions: ExtensionManager
  modelRuntime: ModelRuntime
  providerAuth: ProviderAuthManager
  logger?: FastifyServerOptions['logger']
}

export async function build(options: CreateAppOptions) {
  const { config, sessions, sse, getUsage, flow, extensions, modelRuntime, providerAuth } = options
  const app = Fastify({
    logger: options.logger ?? false,
    routerOptions: {
      // Windows session keys are absolute paths that easily exceed the 100-char default.
      maxParamLength: 500,
      querystringParser: search => Object.fromEntries(new URLSearchParams(search)),
    },
  })
  app.register(httpAuth, config)

  app.setErrorHandler((err, _request, reply) => {
    if (reply.sent) {
      reply.raw.end()
      return
    }
    if (err instanceof SessionsStreamingError)
      return send(reply, 409, { error: String(err), sessions: err.keys })
    if (err instanceof ProviderAuthBusyError)
      return send(reply, 409, { error: err.message })
    const statusCode = typeof err === 'object' && err && 'statusCode' in err && typeof err.statusCode === 'number'
      ? err.statusCode
      : 500
    if (statusCode >= 400 && statusCode < 500)
      return send(reply, statusCode, { error: err instanceof Error ? err.message : String(err) })
    return send(reply, 500, { error: String(err) })
  })

  await app.register(fastifySse)
  app.addHook('preClose', async () => sse.close())
  app.get(API_EVENTS_PATH, { sse: 'only' }, (_request, reply) => {
    sse.open(reply)
  })

  app.get(API_HELLO_PATH, async (_request, reply) => {
    return send(reply, 200, { cwd: config.rootCwd } satisfies HelloResponse)
  })

  app.register(sessionRoutes, { sessions, sse })
  app.register(submissionRoutes, { sessions })
  app.register(usageRoutes, { getUsage, sessions })
  app.register(flowActivityRoutes, { runs: options.runs, reviews: options.reviews })
  app.register(flowRoutes, { config, flow, sessions })
  app.register(runRoutes, { runs: options.runs })
  if (options.reviews && options.reviewGeneration)
    app.register(reviewRoutes, { reviews: options.reviews, generation: options.reviewGeneration, runs: options.runs, isTrusted: project => sessions.getProjectTrust(project).trusted })
  app.register(providerRoutes, { modelRuntime, providerAuth, sessions })
  app.register(projectRoutes, { config, sessions })
  app.register(extensionRoutes, { config, extensions, sessions })

  app.register(fastifyStatic, {
    root: config.webDist,
    cacheControl: false,
    setHeaders(reply) {
      reply.header('x-content-type-options', 'nosniff')
    },
  })

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '/'
    if (path.startsWith('/api/'))
      return send(reply, 404, { error: 'not found' })
    return reply.code(200).sendFile('index.html')
  })

  return app
}
