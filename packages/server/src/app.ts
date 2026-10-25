import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { HelloResponse } from '@piflow/protocol'
import type { FastifyServerOptions } from 'fastify'
import type { ExtensionManager } from './extensions/manager'
import type { FlowStore } from './flow/store'
import type { ProviderAuthManager } from './providers/provider-auth'
import type { UsageSnapshot } from './routes/usage'
import type { ServerConfig } from './server/config'
import type { StaticHandler } from './server/http'
import type { SseHub } from './server/sse'
import type { SessionStore } from './sessions/index'
import fastifySse from '@fastify/sse'
import { API_EVENTS_PATH, API_HELLO_PATH } from '@piflow/protocol'
import Fastify from 'fastify'
import { httpAuth } from './plugins/auth'
import { ProviderAuthBusyError } from './providers/provider-auth'
import { extensionRoutes } from './routes/extensions'
import { flowRoutes } from './routes/flow'
import { projectRoutes } from './routes/project'
import { providerRoutes } from './routes/providers'
import { sessionRoutes } from './routes/sessions'
import { usageRoutes } from './routes/usage'
import { send } from './server/reply'
import { SessionsStreamingError } from './sessions/index'

interface CreateAppOptions {
  config: ServerConfig
  sessions: SessionStore
  sse: SseHub
  serveStatic: StaticHandler
  getUsage: (provider: string, fresh?: boolean) => Promise<UsageSnapshot | null>
  flow: FlowStore
  extensions: ExtensionManager
  modelRuntime: ModelRuntime
  providerAuth: ProviderAuthManager
  logger?: FastifyServerOptions['logger']
}

export async function build(options: CreateAppOptions) {
  const { config, sessions, sse, serveStatic, getUsage, flow, extensions, modelRuntime, providerAuth } = options
  const app = Fastify({
    logger: options.logger ?? false,
    routerOptions: {
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
  app.get(API_EVENTS_PATH, { sse: 'only' }, (_request, reply) => {
    sse.open(reply)
  })

  app.get(API_HELLO_PATH, async (_request, reply) => {
    return send(reply, 200, { cwd: config.rootCwd } satisfies HelloResponse)
  })

  app.register(sessionRoutes, { sessions, sse })
  app.register(usageRoutes, { getUsage, sessions })
  app.register(flowRoutes, { config, flow, sessions })
  app.register(providerRoutes, { modelRuntime, providerAuth, sessions })
  app.register(projectRoutes, { config, sessions })
  app.register(extensionRoutes, { config, extensions, sessions })

  app.setNotFoundHandler(async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/'
    if (path.startsWith('/api/'))
      return send(reply, 404, { error: 'not found' })
    reply.hijack()
    await serveStatic(reply.raw, path)
  })

  return app
}
