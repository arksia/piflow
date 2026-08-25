import type { ChatMessage } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { settledStatusFromMessages } from './core/sessions'

it('marks settled as failed when the last assistant message stopped on error', () => {
  const messages: ChatMessage[] = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'error', stopReason: 'error', errorMessage: 'quota exceeded' },
  ]
  assert.equal(settledStatusFromMessages(messages), 'failed')
})

it('marks settled as idle when the last assistant message succeeded', () => {
  const messages: ChatMessage[] = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'ok' },
  ]
  assert.equal(settledStatusFromMessages(messages), 'idle')
})

it('looks at the most recent assistant message for error status', () => {
  const messages: ChatMessage[] = [
    { role: 'assistant', content: 'first', stopReason: 'error', errorMessage: 'early' },
    { role: 'assistant', content: 'retry ok' },
  ]
  assert.equal(settledStatusFromMessages(messages), 'idle')
})

it('defaults to idle when there are no assistant messages', () => {
  const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }]
  assert.equal(settledStatusFromMessages(messages), 'idle')
})
