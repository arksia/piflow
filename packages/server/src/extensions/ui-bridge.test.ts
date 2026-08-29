import type { ExtensionUIRequest, ServerMessage } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createUiBridge } from './ui-bridge'

function createBridge(onPendingChange?: (requests: ExtensionUIRequest[]) => void) {
  const messages: ServerMessage[] = []
  const bridge = createUiBridge('session-1', message => messages.push(message), onPendingChange)
  return { bridge, messages }
}

function uiRequest(messages: ServerMessage[]): ExtensionUIRequest {
  const message = messages.find(candidate => candidate.type === 'extension_ui_request')
  assert.ok(message?.type === 'extension_ui_request')
  return message.request
}

describe('extension ui bridge', () => {
  it('publishes select requests and resolves with the chosen value', async () => {
    const pendingChanges: ExtensionUIRequest[][] = []
    const { bridge, messages } = createBridge(requests => pendingChanges.push(requests))
    const promise = bridge.context.select('Pick one', ['a', 'b'])
    const request = uiRequest(messages)
    assert.equal(request.method, 'select')
    assert.equal(request.title, 'Pick one')
    assert.deepEqual(request.options, ['a', 'b'])
    assert.deepEqual(bridge.pendingRequests(), [request])
    assert.deepEqual(pendingChanges, [[request]])

    bridge.handleResponse({ id: request.id, session: 'session-1', value: 'b' })
    assert.equal(await promise, 'b')
    assert.deepEqual(bridge.pendingRequests(), [])
    assert.deepEqual(pendingChanges, [[request], []])
  })

  it('resolves confirm with false when cancelled', async () => {
    const { bridge, messages } = createBridge()
    const promise = bridge.context.confirm('Sure?', 'do the thing')
    const request = uiRequest(messages)
    assert.equal(request.method, 'confirm')
    assert.equal(request.message, 'do the thing')

    bridge.handleResponse({ id: request.id, session: 'session-1', cancelled: true })
    assert.equal(await promise, false)
  })

  it('resolves confirm with the confirmed flag', async () => {
    const { bridge, messages } = createBridge()
    const promise = bridge.context.confirm('Sure?', 'do the thing')
    bridge.handleResponse({ id: uiRequest(messages).id, session: 'session-1', confirmed: true })
    assert.equal(await promise, true)
  })

  it('resolves input with undefined when cancelled', async () => {
    const { bridge, messages } = createBridge()
    const promise = bridge.context.input('Name?', 'placeholder')
    const request = uiRequest(messages)
    assert.equal(request.method, 'input')
    assert.equal(request.placeholder, 'placeholder')

    bridge.handleResponse({ id: request.id, session: 'session-1', cancelled: true })
    assert.equal(await promise, undefined)
  })

  it('publishes notify without tracking a pending dialog', () => {
    const pendingChanges: ExtensionUIRequest[][] = []
    const { bridge, messages } = createBridge(requests => pendingChanges.push(requests))
    bridge.context.notify('heads up', 'warning')
    const request = uiRequest(messages)
    assert.equal(request.method, 'notify')
    assert.equal(request.notifyType, 'warning')
    assert.deepEqual(bridge.pendingRequests(), [])
    assert.deepEqual(pendingChanges, [])
  })

  it('ignores responses for unknown dialog ids', () => {
    const { bridge } = createBridge()
    bridge.handleResponse({ id: 'unknown', session: 'session-1' })
    assert.deepEqual(bridge.pendingRequests(), [])
  })

  it('resolves suspended dialogs with defaults on cancelPending', async () => {
    const { bridge } = createBridge()
    const input = bridge.context.input('Name?')
    const confirm = bridge.context.confirm('Sure?', 'msg')
    assert.equal(bridge.pendingRequests().length, 2)

    bridge.cancelPending()
    assert.equal(await input, undefined)
    assert.equal(await confirm, false)
    assert.deepEqual(bridge.pendingRequests(), [])
  })

  it('resolves immediately when the signal is already aborted', async () => {
    const { bridge, messages } = createBridge()
    const controller = new AbortController()
    controller.abort()
    assert.equal(await bridge.context.select('Pick', ['a'], { signal: controller.signal }), undefined)
    assert.deepEqual(bridge.pendingRequests(), [])
    assert.equal(messages.length, 0)
  })

  it('resolves with the default when the extension timeout elapses', async () => {
    const { bridge } = createBridge()
    const promise = bridge.context.select('Pick', ['a'], { timeout: 10 })
    assert.equal(await promise, undefined)
    assert.deepEqual(bridge.pendingRequests(), [])
  })
})
