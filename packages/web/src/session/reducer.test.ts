import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { JsonAgentSessionEvent } from '@earendil-works/pi-coding-agent'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { applyAssistantUpdate } from './reducer'

type AssistantMessage = Extract<AgentMessage, { role: 'assistant' }>
type MessageUpdate = Extract<JsonAgentSessionEvent, { type: 'message_update' }>['assistantMessageEvent']

const base: AssistantMessage = {
  role: 'assistant',
  content: [],
  api: 'test',
  provider: 'test',
  model: 'test',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: 'stop',
  timestamp: 1,
}

function update(message: AssistantMessage, assistantMessageEvent: MessageUpdate) {
  return applyAssistantUpdate(message, assistantMessageEvent)
}

it('rebuilds streamed assistant content from RPC deltas', () => {
  let message = update(base, { type: 'text_start', contentIndex: 0 })
  message = update(message, { type: 'text_delta', contentIndex: 0, delta: 'hello' })
  message = update(message, { type: 'thinking_start', contentIndex: 1 })
  message = update(message, { type: 'thinking_delta', contentIndex: 1, delta: 'hmm' })
  message = update(message, { type: 'toolcall_start', contentIndex: 2, id: 'call-1', toolName: 'read' })
  message = update(message, { type: 'toolcall_delta', contentIndex: 2, delta: '{"path":' })
  assert.deepEqual(message.content[2], { type: 'toolCall', id: 'call-1', name: 'read', arguments: {} })
  message = update(message, { type: 'toolcall_delta', contentIndex: 2, delta: '"README.md"}' })
  assert.deepEqual(message.content[2], { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'README.md' } })
  message = update(message, {
    type: 'toolcall_end',
    contentIndex: 2,
    toolCall: { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'README.md' } },
  })

  assert.deepEqual(message.content, [
    { type: 'text', text: 'hello' },
    { type: 'thinking', thinking: 'hmm' },
    { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'README.md' } },
  ])
})
