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
    store.activeKey = null
    store.views = {}
  }
})

it('sends a prompt to a background session without switching the open chat', async () => {
  const previousFetch = globalThis.fetch
  const previousDocument = globalThis.document
  const previousFrame = globalThis.requestAnimationFrame
  let posted = ''
  globalThis.fetch = async (input) => {
    posted = String(input)
    return new Response(JSON.stringify({ ok: true }), { status: 202 })
  }
  globalThis.document = { hidden: false } as Document
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  store.connected = true
  store.activeKey = 'main'
  store.views = {}
  ensureView('main')

  try {
    await sendPrompt('划分模块', undefined, undefined, 'conductor')
    assert.equal(store.activeKey, 'main')
    assert.match(posted, /conductor/)
    assert.equal(ensureView('main').messages.length, 0)
    const sent = ensureView('conductor').messages.at(-1)
    assert.equal(sent?.role, 'user')
    assert.equal(sent && sent.role === 'user' ? sent.content : '', '划分模块')
  }
  finally {
    globalThis.fetch = previousFetch
    globalThis.document = previousDocument
    globalThis.requestAnimationFrame = previousFrame
    store.activeKey = null
    store.views = {}
  }
})
