import type { RpcExtensionUIRequest } from '@earendil-works/pi-coding-agent'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createExtensionUIContext } from './extension-ui'

function createUI() {
  const requests: RpcExtensionUIRequest[] = []
  let changes = 0
  const ui = createExtensionUIContext(request => requests.push(request), () => changes++)
  return { ui, requests, changes: () => changes }
}

describe('extension UI context', () => {
  it('settles a dialog once and removes it from the snapshot', async () => {
    const { ui, requests } = createUI()
    const answer = ui.select('Pick', ['a', 'b'])
    const request = requests[0]!

    assert.equal(ui.hasPendingDialogs(), true)
    assert.equal(ui.respond({ type: 'extension_ui_response', id: request.id, value: 'b' }), true)
    assert.equal(ui.respond({ type: 'extension_ui_response', id: request.id, value: 'a' }), false)
    assert.equal(await answer, 'b')
    assert.equal(ui.hasPendingDialogs(), false)
  })

  it('uses the official default when a dialog times out', async () => {
    const { ui } = createUI()
    assert.equal(await ui.confirm('Continue?', 'Really?', { timeout: 1 }), false)
    assert.deepEqual(ui.snapshot(), [])
  })

  it('retains status and string widgets but not immediate commands', () => {
    const { ui, requests } = createUI()
    ui.setStatus('sync', 'Working')
    ui.setWidget('todo', ['one'])
    ui.setTitle('Session')
    ui.setEditorText('draft')

    assert.deepEqual(ui.snapshot().map(request => request.method), ['setStatus', 'setWidget'])
    assert.deepEqual(requests.map(request => request.method), ['setStatus', 'setWidget', 'setTitle', 'set_editor_text'])
  })
})
