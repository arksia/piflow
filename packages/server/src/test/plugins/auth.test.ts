import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import Fastify from 'fastify'
import { AUTH_COOKIE } from '../../auth'
import { httpAuth } from '../../plugins/auth'

const token = '0123456789abcdef0123456789abcdef'
const authHeader = `${AUTH_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`

function app(isLoopback = true) {
  const server = Fastify({ logger: false })
  void server.register(httpAuth, { authHeader, authToken: token, isLoopback })
  server.get('/api/hello', async () => ({ ok: true }))
  return server
}

describe('http auth', () => {
  it('rejects an api call that has no cookie', async () => {
    const server = app()
    const response = await server.inject({ method: 'GET', url: '/api/hello' })
    assert.equal(response.statusCode, 401)
    await server.close()
  })

  it('rejects an api call from another origin', async () => {
    const server = app()
    const response = await server.inject({
      headers: { cookie: `${AUTH_COOKIE}=${token}`, origin: 'http://evil.test' },
      method: 'GET',
      url: '/api/hello',
    })
    assert.equal(response.statusCode, 403)
    await server.close()
  })

  it('accepts an api call that carries the cookie', async () => {
    const server = app()
    const response = await server.inject({
      headers: { cookie: `${AUTH_COOKIE}=${token}` },
      method: 'GET',
      url: '/api/hello',
    })
    assert.equal(response.statusCode, 200)
    await server.close()
  })

  it('sets the cookie for a loopback auth request', async () => {
    const server = app()
    const response = await server.inject({ method: 'GET', url: '/auth' })
    assert.equal(response.statusCode, 204)
    const cookie = response.headers['set-cookie']
    const header = Array.isArray(cookie) ? cookie.join('; ') : cookie ?? ''
    assert.match(header, /HttpOnly/)
    assert.match(header, /SameSite=Strict/)
    await server.close()
  })

  it('refuses auth off loopback without the token', async () => {
    const server = app(false)
    const response = await server.inject({ method: 'GET', url: '/auth' })
    assert.equal(response.statusCode, 401)
    await server.close()
  })
})
