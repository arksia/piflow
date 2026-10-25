import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { ExtensionManager } from '../extensions/manager'
import type { FlowStore } from '../flow/store'
import type { ProviderAuthManager } from '../providers/provider-auth'
import type { SessionStore } from '../sessions/index'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { build } from '../app'
import { AUTH_COOKIE } from '../auth'
import { loadConfig } from '../server/config'

const token = '0123456789abcdef0123456789abcdef'
const webDist = mkdtempSync(join(tmpdir(), 'piflow-static-'))
writeFileSync(join(webDist, 'index.html'), 'static')
writeFileSync(join(webDist, 'app.js'), 'console.log(1)')

function testApp() {
  const config = { ...loadConfig({ HOST: '127.0.0.1', PIFLOW_TOKEN: token, PORT: '3141' }), webDist }
  return build({
    config,
    extensions: {} as ExtensionManager,
    flow: {} as FlowStore,
    getUsage: async () => null,
    logger: false,
    modelRuntime: {} as ModelRuntime,
    providerAuth: {} as ProviderAuthManager,
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

  it('serves the web dist and falls back to index.html', async () => {
    const app = await testApp()
    const root = await app.inject({ method: 'GET', url: '/' })
    assert.equal(root.statusCode, 200)
    assert.equal(root.body, 'static')
    assert.equal(root.headers['x-content-type-options'], 'nosniff')
    const asset = await app.inject({ method: 'GET', url: '/app.js' })
    assert.equal(asset.statusCode, 200)
    assert.equal(asset.body, 'console.log(1)')
    const route = await app.inject({ method: 'GET', url: '/canvas' })
    assert.equal(route.statusCode, 200)
    assert.equal(route.body, 'static')
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
