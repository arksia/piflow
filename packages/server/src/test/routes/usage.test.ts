import type { SessionStore } from '../../sessions/index'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { API_USAGE_PATH } from '@piflow/protocol'
import Fastify from 'fastify'
import { usageRoutes } from '../../routes/usage'

it('reports an unsupported provider when no adapter matches', async () => {
  let fresh: boolean | undefined
  const app = Fastify({ logger: false })
  await app.register(usageRoutes, {
    getUsage: async (_provider, isFresh) => {
      fresh = isFresh
      return null
    },
    sessions: { get: () => undefined } as unknown as SessionStore,
  })
  const response = await app.inject({ method: 'GET', url: `${API_USAGE_PATH}?provider=kimi&fresh=1` })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { provider: 'kimi', supported: false, windows: [] })
  assert.equal(fresh, true)
  await app.close()
})
