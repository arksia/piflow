import assert from 'node:assert/strict'
import { it } from 'node:test'
import { validatePromptImages } from './routes'

it('accepts pi image content and rejects invalid or oversized images', () => {
  assert.equal(validatePromptImages([{ type: 'image', data: 'aA==', mimeType: 'image/png' }]), null)
  assert.match(validatePromptImages([{ type: 'image', data: '*', mimeType: 'image/png' }]) ?? '', /valid base64/)
  assert.match(validatePromptImages(Array.from({ length: 11 }, () => ({ type: 'image', data: 'aA==', mimeType: 'image/png' }))) ?? '', /at most 10/)
})
