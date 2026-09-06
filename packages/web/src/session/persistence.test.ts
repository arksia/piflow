import assert from 'node:assert/strict'
import { it } from 'node:test'
import { migrateDraft, readDraft, saveDraft } from './persistence'

it('persists and clears text drafts by session key', () => {
  const values = new Map<string, string>()
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  })
  saveDraft('session-a', 'draft')
  assert.equal(readDraft('session-a'), 'draft')
  assert.equal(readDraft('session-b'), '')
  saveDraft('session-a', '')
  assert.equal(readDraft('session-a'), '')
  saveDraft('new:/project', 'new draft')
  migrateDraft('new:/project', 'session-c')
  assert.equal(readDraft('session-c'), 'new draft')
  assert.equal(readDraft('new:/project'), '')
})
