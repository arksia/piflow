import assert from 'node:assert/strict'
import { it } from 'node:test'
import { clearDraft, migrateDraft, readDraft, saveDraftImages, saveDraftText } from './persistence'

it('keeps text and images together in memory by session key', () => {
  const image = { id: 'image-1', type: 'image', data: 'aA==', mimeType: 'image/png', previewUrl: 'data:image/png;base64,aA==' } as const
  saveDraftText('session-a', 'draft')
  saveDraftImages('session-a', [image])
  assert.deepEqual(readDraft('session-a'), { text: 'draft', images: [image] })
  assert.deepEqual(readDraft('session-b'), { text: '', images: [] })
  clearDraft('session-a')
  assert.deepEqual(readDraft('session-a'), { text: '', images: [] })
  saveDraftText('new:/project', 'new draft')
  saveDraftImages('new:/project', [image])
  migrateDraft('new:/project', 'session-c')
  assert.deepEqual(readDraft('session-c'), { text: 'new draft', images: [image] })
  assert.deepEqual(readDraft('new:/project'), { text: '', images: [] })
})
