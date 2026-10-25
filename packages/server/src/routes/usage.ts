import type { UsageReport, UsageWindow } from '@piflow/protocol'
import type { FastifyPluginAsync } from 'fastify'
import type { SessionStore } from '../sessions/index'
import { API_USAGE_PATH } from '@piflow/protocol'
import { query, send } from '../server/reply'

export interface UsageSnapshot {
  plan?: string
  windows: UsageWindow[]
}

interface UsageRouteOptions {
  getUsage: (provider: string, fresh?: boolean) => Promise<UsageSnapshot | null>
  sessions: SessionStore
}

export const usageRoutes: FastifyPluginAsync<UsageRouteOptions> = async (app, options) => {
  const { getUsage, sessions } = options

  app.get(API_USAGE_PATH, async (request, reply) => {
    const { fresh, key, provider: named } = query(request)
    const managed = key ? sessions.get(key) : undefined
    const provider = managed?.runtime.session.model?.provider ?? named
    if (!provider)
      return send(reply, 200, { provider: null, supported: false, windows: [] } satisfies UsageReport)
    const report = await getUsage(provider, fresh === '1')
    return send(reply, 200, {
      provider,
      supported: !!report,
      plan: report?.plan,
      windows: report?.windows ?? [],
    } satisfies UsageReport)
  })
}
