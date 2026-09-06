import assert from 'node:assert/strict'
import { it } from 'node:test'
import { sendPrompt } from './actions'
import { readDraft, saveDraftImages, saveDraftText } from './persistence'
import { ensureView, store } from './store'

it('keeps the draft when a prompt request is rejected', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('network unavailable')
  }
  store.connected = true
  store.activeKey = 'session-a'
  store.views = {}
  const image = { id: 'image-1', type: 'image', data: 'aA==', mimeType: 'image/png', previewUrl: 'data:image/png;base64,aA==' } as const
  saveDraftText('session-a', 'draft')
  saveDraftImages('session-a', [image])

  try {
    await assert.rejects(sendPrompt('draft', [image]), /network unavailable/)
    assert.deepEqual(readDraft('session-a'), { text: 'draft', images: [image] })
    assert.deepEqual(ensureView('session-a').messages, [])
  }
  finally {
    globalThis.fetch = previousFetch
  }
})
