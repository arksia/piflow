import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { listProviders } from './providers'

function runtime(listCredentials: ModelRuntime['listCredentials']) {
  return {
    listCredentials,
    getModels: () => [
      { provider: 'dual' },
      { provider: 'dual' },
    ],
    getProviders: () => [{
      id: 'dual',
      name: 'Dual Provider',
      auth: {
        apiKey: { name: 'API key', login: async () => ({ type: 'api_key' as const }), resolve: async () => undefined },
        oauth: { name: 'Subscription' },
      },
    }],
    getProviderAuthStatus: () => ({ configured: true, source: 'stored' as const }),
  } as unknown as Pick<ModelRuntime, 'getModels' | 'getProviderAuthStatus' | 'getProviders' | 'listCredentials'>
}

it('lists native auth capabilities and non-secret credential metadata', async () => {
  const providers = await listProviders(runtime(async () => [{ providerId: 'dual', type: 'oauth' }]))
  assert.deepEqual(providers, [{
    id: 'dual',
    name: 'Dual Provider',
    authTypes: ['api_key', 'oauth'],
    oauthName: 'Subscription',
    credentialType: 'oauth',
    configured: true,
    source: 'stored',
    modelCount: 2,
  }])
})

it('keeps providers visible when credential enumeration fails', async () => {
  const providers = await listProviders(runtime(async () => {
    throw new Error('broken auth.json')
  }))
  assert.equal(providers.length, 1)
  assert.equal(providers[0]?.credentialType, undefined)
})
