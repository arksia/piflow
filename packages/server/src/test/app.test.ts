import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { ServerResponse } from 'node:http'
import type { ExtensionManager } from '../extensions/manager'
import type { FlowStore } from '../flow/store'
import type { ProviderAuthManager } from '../providers/provider-auth'
import type { SessionStore } from '../sessions/index'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { build } from '../app'
import { AUTH_COOKIE } from '../auth'
import { loadConfig } from '../server/config'

const token = '0123456789abcdef0123456789abcdef'

function testApp() {
  const config = loadConfig({ HOST: '127.0.0.1', PIFLOW_TOKEN: token, PORT: '3141' })
  return build({
    config,
    extensions: {} as ExtensionManager,
    flow: {} as FlowStore,
    getUsage: async () => null,
    logger: false,
    modelRuntime: {} as ModelRuntime,
    providerAuth: {} as ProviderAuthManager,
    serveStatic: async (res: ServerResponse) => {
      res.writeHead(200, { 'content-type': 'text/html' }).end('static')
    },
    sessions: { disposeAll: async () => {}, get: () => undefined } as unknown as SessionStore,
    sse: { broadcast() {}, open() {}, setStateSnapshotProvider() {}, setStatusSnapshotProvider() {} },
  })
}

describe('fastify app', () => {
  it('serves hello when the cookie is present', async () => {
    const app = await testApp()
    const response = await app.inject({
      headers: { cookie: `${AUTH_COOKIE}=${token}` },
      method: 'GET',
      url: '/api/hello',
    })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().cwd, loadConfig({ HOST: '127.0.0.1', PIFLOW_TOKEN: token, PORT: '3141' }).rootCwd)
    await app.close()
  })

  it('serves the static handler outside the api', async () => {
    const app = await testApp()
    const response = await app.inject({ method: 'GET', url: '/' })
    assert.equal(response.statusCode, 200)
    assert.equal(response.body, 'static')
    await app.close()
  })

  it('returns not found for an unknown api path', async () => {
    const app = await testApp()
    const response = await app.inject({
      headers: { cookie: `${AUTH_COOKIE}=${token}` },
      method: 'GET',
      url: '/api/nope',
    })
    assert.equal(response.statusCode, 404)
    assert.equal(response.json().error, 'not found')
    await app.close()
  })
})
