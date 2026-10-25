import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { ServerConfig } from '../server/config'
import cookie from '@fastify/cookie'
import { AUTH_PATH } from '@piflow/protocol'
import fp from 'fastify-plugin'
import { AUTH_COOKIE, isAllowedOrigin } from '../auth'
import { query } from '../server/reply'

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function trustedOrigin(request: FastifyRequest): boolean {
  const origin = one(request.headers.origin)
  if (origin === undefined)
    return true
  return isAllowedOrigin(origin, one(request.headers.host))
}

export type HttpAuthOptions = Pick<ServerConfig, 'authToken' | 'isLoopback'>

const httpAuthPlugin: FastifyPluginAsync<HttpAuthOptions> = async (app, config) => {
  await app.register(cookie)

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/'
    if (!path.startsWith('/api/'))
      return
    if (!trustedOrigin(request))
      return reply.code(403).header('cache-control', 'no-store').send({ error: 'forbidden origin' })
    if (request.cookies[AUTH_COOKIE] !== config.authToken)
      return reply.code(401).header('cache-control', 'no-store').send({ error: 'unauthorized' })
  })

  app.all(AUTH_PATH, async (request, reply) => {
    if (!trustedOrigin(request))
      return reply.code(403).header('cache-control', 'no-store').send()
    const supplied = query(request).token
    const authenticated = config.isLoopback
      || supplied === config.authToken
      || request.cookies[AUTH_COOKIE] === config.authToken
    if (!authenticated)
      return reply.code(401).header('cache-control', 'no-store').send()
    return reply.code(204).header('cache-control', 'no-store').setCookie(AUTH_COOKIE, config.authToken, {
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
    }).send()
  })
}

export const httpAuth = fp(httpAuthPlugin, { name: 'piflow-auth' })
