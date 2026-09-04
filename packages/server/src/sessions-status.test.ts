import type { AgentMessage } from '@earendil-works/pi-agent-core'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { settledStatusFromMessages } from './core/sessions'

it('marks settled as failed when the last assistant message stopped on error', () => {
  const messages = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'error', stopReason: 'error', errorMessage: 'quota exceeded' },
  ] as unknown as AgentMessage[]
  assert.equal(settledStatusFromMessages(messages), 'failed')
})

it('marks settled as idle when the last assistant message succeeded', () => {
  const messages = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'ok' },
  ] as unknown as AgentMessage[]
  assert.equal(settledStatusFromMessages(messages), 'idle')
})

it('looks at the most recent assistant message for error status', () => {
  const messages = [
    { role: 'assistant', content: 'first', stopReason: 'error', errorMessage: 'early' },
    { role: 'assistant', content: 'retry ok' },
  ] as unknown as AgentMessage[]
  assert.equal(settledStatusFromMessages(messages), 'idle')
})

it('defaults to idle when there are no assistant messages', () => {
  const messages: AgentMessage[] = [{ role: 'user', content: 'hello', timestamp: Date.now() }]
  assert.equal(settledStatusFromMessages(messages), 'idle')
})
