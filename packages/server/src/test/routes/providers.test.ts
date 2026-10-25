import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { ProviderAuthManager } from '../../providers/provider-auth'
import type { SessionStore } from '../../sessions/index'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { API_PROVIDERS_PATH } from '@piflow/protocol'
import Fastify from 'fastify'
import { providerRoutes } from '../../routes/providers'

it('lists providers from the runtime catalog', async () => {
  const app = Fastify({ logger: false })
  await app.register(providerRoutes, {
    modelRuntime: {
      getModels: () => [],
      getProviders: () => [],
      listCredentials: async () => [],
    } as unknown as ModelRuntime,
    providerAuth: {} as ProviderAuthManager,
    sessions: {} as SessionStore,
  })
  const response = await app.inject({ method: 'GET', url: API_PROVIDERS_PATH })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json().providers, [])
  await app.close()
})
