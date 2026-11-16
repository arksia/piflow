import assert from 'node:assert/strict'
import { it } from 'node:test'
import { store } from './store'
import { initClient, markConnected, markReconnecting } from './transport'

it('shows reconnecting after an established SSE connection drops', () => {
  Object.assign(globalThis, {
    document: { hidden: false },
    requestAnimationFrame: (callback: () => void) => {
      callback()
      return 1
    },
  })
  markConnected()
  assert.equal(store.connected, true)
  assert.equal(store.connectionState, 'connected')
  markReconnecting()
  assert.equal(store.connected, false)
  assert.equal(store.connectionState, 'reconnecting')
  markConnected()
  assert.equal(store.connectionState, 'connected')
})

it('refreshes authentication before reconnecting SSE after a server restart', async () => {
  const keys = ['fetch', 'EventSource', 'location', 'setTimeout'] as const
  const previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key))
  const sources: { closed: boolean, onerror: (() => void) | null }[] = []
  const requests: string[] = []
  let retry: (() => void) | undefined
  Object.assign(globalThis, {
    location: { href: 'http://127.0.0.1:3141/' },
    fetch: async (url: string) => {
      requests.push(url)
      return new Response(null, { status: 204 })
    },
    EventSource: class {
      closed = false
      onerror = null
      constructor() { sources.push(this) }
      close() { this.closed = true }
    },
    setTimeout: (callback: () => void) => {
      retry = callback
      return 1
    },
  })
  try {
    initClient()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(sources.length, 1)
    sources[0]!.onerror!()
    assert.equal(sources[0]!.closed, true)
    assert.equal(store.connectionState, 'reconnecting')
    retry!()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(sources.length, 2)
    assert.equal(requests.length, 2)
    assert.equal(requests[0], requests[1])
    assert.match(requests[1]!, /auth/)
  }
  finally {
    keys.forEach((key, index) => {
      const descriptor = previous[index]
      if (descriptor)
        Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
})
