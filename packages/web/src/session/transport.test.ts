import assert from 'node:assert/strict'
import { it } from 'node:test'
import { store } from './store'
import { markConnected, markReconnecting } from './transport'

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
