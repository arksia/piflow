import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { HelloResponse, UsageWindow } from '@piflow/protocol'
import type { ExtensionManager } from '../extensions/manager'
import type { FlowStore } from '../flow/store'
import type { ServerConfig } from './config'
import type { StaticHandler } from './http'
import type { ProviderAuthManager } from './provider-auth'
import type { SessionStore } from './sessions'
import type { SseHub } from './sse'
import { API_EVENTS_PATH, API_HELLO_PATH } from '@piflow/protocol'
import Fastify from 'fastify'
import { registerHttpAuth } from './http-auth'
import { send } from './http-reply'
import { ProviderAuthBusyError } from './provider-auth'
import { registerFlowRoutes } from './routes-flow'
import { registerProjectRoutes } from './routes-project'
import { registerProviderRoutes } from './routes-providers'
import { registerSessionRoutes } from './routes-sessions'
import { SessionsStreamingError } from './sessions'

interface UsageSnapshot {
  plan?: string
  windows: UsageWindow[]
}

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
}

export function createApp(options: CreateAppOptions) {
  const { config, sessions, sse, serveStatic, getUsage, flow, extensions, modelRuntime, providerAuth } = options
  const app = Fastify({
    bodyLimit: 140 * 1024 * 1024,
    logger: false,
  })
  registerHttpAuth(app, config)

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

  app.get(API_EVENTS_PATH, (request, reply) => {
    reply.hijack()
    sse.open(request.raw, reply.raw)
  })

  app.get(API_HELLO_PATH, async (_request, reply) => {
    return send(reply, 200, { cwd: config.rootCwd } satisfies HelloResponse)
  })

  registerSessionRoutes(app, { getUsage, sessions, sse })
  registerFlowRoutes(app, { config, flow, sessions })
  registerProviderRoutes(app, { modelRuntime, providerAuth, sessions })
  registerProjectRoutes(app, { config, extensions, sessions })

  app.setNotFoundHandler(async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/'
    if (path.startsWith('/api/'))
      return send(reply, 404, { error: 'not found' })
    reply.hijack()
    await serveStatic(reply.raw, path)
  })

  return app
}

export { validatePromptImages } from './routes-sessions'
