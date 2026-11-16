import type { AgentMessage } from '@earendil-works/pi-agent-core'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { turnToolCount } from './facts'

const user = { role: 'user', content: '读两个文件' } as AgentMessage
const tools = {
  role: 'assistant',
  content: [
    { type: 'toolCall', id: 'a', name: 'read', arguments: {} },
    { type: 'toolCall', id: 'b', name: 'read', arguments: {} },
  ],
} as AgentMessage
const text = { role: 'assistant', content: [{ type: 'text', text: '说明' }] } as AgentMessage

test('turnToolCount includes tool calls from earlier messages in the same reply', () => {
  const messages = [user, tools, { role: 'toolResult' } as AgentMessage, text]
  assert.equal(turnToolCount(messages, 3), 2)
  assert.equal(turnToolCount(messages, 1), 2)
})

test('turnToolCount stops at the previous user message', () => {
  const earlier = { role: 'assistant', content: [{ type: 'toolCall', id: 'c', name: 'bash', arguments: {} }] } as AgentMessage
  const messages = [earlier, user, text]
  assert.equal(turnToolCount(messages, 2), 0)
})
