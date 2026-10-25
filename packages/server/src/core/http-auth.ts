import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ServerConfig } from './config'
import { AUTH_PATH } from '@piflow/protocol'
import { hasAuthCookie, isAllowedOrigin } from '../auth'

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function trustedOrigin(request: FastifyRequest): boolean {
  const origin = one(request.headers.origin)
  if (origin === undefined)
    return true
  return isAllowedOrigin(origin, one(request.headers.host))
}

export function registerHttpAuth(app: FastifyInstance, config: Pick<ServerConfig, 'authHeader' | 'authToken' | 'isLoopback'>): void {
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/'
    if (!path.startsWith('/api/'))
      return
    if (!trustedOrigin(request))
      return reply.code(403).header('cache-control', 'no-store').send({ error: 'forbidden origin' })
    if (!hasAuthCookie(one(request.headers.cookie), config.authToken))
      return reply.code(401).header('cache-control', 'no-store').send({ error: 'unauthorized' })
  })

  app.all(AUTH_PATH, async (request, reply) => {
    if (!trustedOrigin(request))
      return reply.code(403).header('cache-control', 'no-store').send()
    const supplied = new URL(request.url, 'http://localhost').searchParams.get('token')
    const authenticated = config.isLoopback
      || supplied === config.authToken
      || hasAuthCookie(one(request.headers.cookie), config.authToken)
    if (!authenticated)
      return reply.code(401).header('cache-control', 'no-store').send()
    return reply.code(204).header('cache-control', 'no-store').header('set-cookie', config.authHeader).send()
  })
}
