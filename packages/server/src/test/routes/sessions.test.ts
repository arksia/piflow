import type { SseHub } from '../../server/sse'
import type { SessionStore } from '../../sessions/index'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import Fastify from 'fastify'
import { sessionRoutes } from '../../routes/sessions'

const sse = { broadcast() {} } as unknown as SseHub

describe('session routes', () => {
  it('decodes the session key, limits ordinary bodies, and closes the store', async () => {
    let disposed = false
    const app = Fastify({ logger: false })
    await app.register(sessionRoutes, {
      sessions: {
        disposeAll: async () => {
          disposed = true
        },
        get: () => undefined,
      } as unknown as SessionStore,
      sse,
    })
    const key = 'C:/tmp/session.jsonl'
    const missing = await app.inject({
      method: 'POST',
      payload: { text: 'hi' },
      url: `/api/sessions/${encodeURIComponent(key)}/prompt`,
    })
    assert.equal(missing.statusCode, 404)
    assert.equal(missing.json().error, `session not open: ${key}`)

    const huge = JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024) })
    const limited = await app.inject({
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      payload: huge,
      url: `/api/sessions/${encodeURIComponent(key)}/rename`,
    })
    assert.equal(limited.statusCode, 413)
    const prompt = await app.inject({
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      payload: huge,
      url: `/api/sessions/${encodeURIComponent(key)}/prompt`,
    })
    assert.equal(prompt.statusCode, 404)
    await app.close()
    assert.equal(disposed, true)
  })
})
