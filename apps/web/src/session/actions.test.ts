import assert from 'node:assert/strict'
import { it } from 'node:test'
import { newSession, openSession, selectProjectForNewChat, sendPrompt } from './actions'
import { readDraft, saveDraftImages, saveDraftText } from './persistence'
import { ensureView, store } from './store'

it('selects a project for a new chat without creating a session', () => {
  const previousDocument = globalThis.document
  const previousFrame = globalThis.requestAnimationFrame
  const previousStorage = globalThis.localStorage
  const previousFetch = globalThis.fetch
  let fetched = false
  globalThis.document = { hidden: false } as Document
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.localStorage = { removeItem: () => {} } as unknown as Storage
  globalThis.fetch = async () => {
    fetched = true
    throw new Error('unexpected session creation')
  }
  store.activeKey = 'previous-session'
  store.cwd = '/previous/project'
  store.workspaceView = 'flow'

  try {
    selectProjectForNewChat('/next/project')
    assert.equal(fetched, false)
    assert.equal(store.activeKey, null)
    assert.equal(store.cwd, '/next/project')
    assert.equal(store.workspaceView, 'chat')
  }
  finally {
    globalThis.document = previousDocument
    globalThis.requestAnimationFrame = previousFrame
    globalThis.localStorage = previousStorage
    globalThis.fetch = previousFetch
    store.activeKey = null
    store.cwd = ''
    store.workspaceView = 'chat'
  }
})

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

it('preserves both session drafts when opening a review parent, and migrates only a new chat draft', async () => {
  const previous = { fetch: globalThis.fetch, document: globalThis.document, frame: globalThis.requestAnimationFrame, storage: globalThis.localStorage, window: globalThis.window }
  const state = { key: 'parent-review', cwd: '/project', sessionFile: '/parent', messages: [], isStreaming: false, isCompacting: false, autoCompactionEnabled: true, model: null, thinkingLevel: null, thinkingLevels: [], context: null, queue: { steering: [], followUp: [] }, extensionRequests: [], error: null }
  globalThis.document = { hidden: false } as Document
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.localStorage = { setItem: () => {} } as unknown as Storage
  globalThis.window = { setTimeout: () => 0 } as unknown as Window & typeof globalThis
  globalThis.fetch = async () => new Response(JSON.stringify({ state, models: [], status: { trusted: true } }), { status: 200 })
  store.activeKey = 'other-review'
  store.views = {}
  saveDraftText('other-review', 'unrelated draft')
  saveDraftText('parent-review', 'parent draft')
  try {
    await openSession('/parent')
    assert.equal(readDraft('other-review').text, 'unrelated draft')
    assert.equal(readDraft('parent-review').text, 'parent draft')
    await openSession('/parent')
    assert.equal(readDraft('parent-review').text, 'parent draft')
    store.activeKey = null
    store.cwd = '/project'
    saveDraftText('new:/project', 'new chat draft')
    state.key = 'created-review'
    await newSession()
    assert.equal(readDraft('created-review').text, 'new chat draft')
    assert.equal(readDraft('new:/project').text, '')
    assert.equal(readDraft('parent-review').text, 'parent draft')
  }
  finally {
    globalThis.fetch = previous.fetch
    globalThis.document = previous.document
    globalThis.requestAnimationFrame = previous.frame
    globalThis.localStorage = previous.storage
    globalThis.window = previous.window
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
