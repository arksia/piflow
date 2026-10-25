import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type {
  ProviderAuthLoginRequest,
  ProviderAuthResponse,
  ProviderCheckResponse,
  ProvidersResponse,
} from '@piflow/protocol'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ProviderAuthManager } from './provider-auth'
import type { SessionStore } from './sessions'
import {
  API_PROVIDER_AUTH_PATH,
  API_PROVIDERS_PATH,
} from '@piflow/protocol'
import { param, payload, send } from './http-reply'
import { listProviders } from './providers'
import { SessionsStreamingError } from './sessions'

interface RegisterProviderRoutesOptions {
  modelRuntime: ModelRuntime
  providerAuth: ProviderAuthManager
  sessions: SessionStore
}

export function registerProviderRoutes(app: FastifyInstance, options: RegisterProviderRoutesOptions): void {
  const { modelRuntime, providerAuth, sessions } = options

  function requireProvider(reply: FastifyReply, providerId: string): boolean {
    if (modelRuntime.getProvider(providerId))
      return true
    send(reply, 404, { error: `provider not found: ${providerId}` })
    return false
  }

  app.get(API_PROVIDERS_PATH, async (_request, reply) => {
    return send(reply, 200, { providers: await listProviders(modelRuntime) } satisfies ProvidersResponse)
  })

  app.delete('/api/providers/:providerId/logout', async (request, reply) => {
    const providerId = param(request, 'providerId')
    if (!requireProvider(reply, providerId))
      return
    sessions.assertProviderIdle(providerId)
    await modelRuntime.logout(providerId)
    await sessions.refreshProvider(providerId)
    return send(reply, 200, { providers: await listProviders(modelRuntime) } satisfies ProvidersResponse)
  })

  app.post('/api/providers/:providerId/check', async (request, reply) => {
    const providerId = param(request, 'providerId')
    if (!requireProvider(reply, providerId))
      return
    const check = await modelRuntime.checkAuth(providerId, { signal: AbortSignal.timeout(15_000) })
    return send(reply, 200, {
      configured: !!check,
      type: check?.type,
      source: check?.source,
    } satisfies ProviderCheckResponse)
  })

  app.post('/api/providers/:providerId/refresh', async (request, reply) => {
    const providerId = param(request, 'providerId')
    if (!requireProvider(reply, providerId))
      return
    try {
      sessions.assertProviderIdle(providerId)
    }
    catch (error) {
      if (error instanceof SessionsStreamingError)
        return send(reply, 409, { error: error.message })
      throw error
    }
    const result = await modelRuntime.refresh({
      allowNetwork: true,
      force: true,
      providers: [providerId],
      signal: AbortSignal.timeout(15_000),
    })
    const error = result.errors.get(providerId)
    if (error)
      return send(reply, 502, { error: error.message })
    try {
      await sessions.refreshProvider(providerId)
    }
    catch (error) {
      if (error instanceof SessionsStreamingError)
        return send(reply, 409, { error: error.message })
      throw error
    }
    return send(reply, 200, { providers: await listProviders(modelRuntime) } satisfies ProvidersResponse)
  })

  app.post(API_PROVIDER_AUTH_PATH, async (request, reply) => {
    const body = payload<Partial<ProviderAuthLoginRequest>>(request)
    if (typeof body.providerId !== 'string' || (body.type !== 'api_key' && body.type !== 'oauth'))
      return send(reply, 400, { error: 'providerId and valid type required' })
    sessions.assertIdle()
    return send(reply, 202, await providerAuth.start(body.providerId, body.type))
  })

  app.post(`${API_PROVIDER_AUTH_PATH}/:operationId`, async (request, reply) => {
    const operationId = param(request, 'operationId')
    const body = payload<Partial<ProviderAuthResponse>>(request)
    if (typeof body.promptId !== 'string' || typeof body.value !== 'string' || body.operationId !== operationId)
      return send(reply, 400, { error: 'valid provider auth response required' })
    return send(reply, providerAuth.respond(operationId, body.promptId, body.value) ? 200 : 404, { ok: true })
  })

  app.delete(`${API_PROVIDER_AUTH_PATH}/:operationId`, async (request, reply) => {
    const operationId = param(request, 'operationId')
    return send(reply, providerAuth.cancel(operationId) ? 200 : 404, { ok: true })
  })
}
