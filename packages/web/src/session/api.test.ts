import assert from 'node:assert/strict'
import { it } from 'node:test'
import { api } from './api'

it('surfaces server errors for startup and control requests', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'session failed to start' }), { status: 500 })
  try {
    await assert.rejects(api('/api/sessions/open', { method: 'POST' }), /session failed to start/)
  }
  finally {
    globalThis.fetch = previous
  }
})
