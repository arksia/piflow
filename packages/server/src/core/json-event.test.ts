import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { toJsonEvent } from './json-event'

it('removes cumulative partials and retains tool call identity', () => {
  const event = {
    type: 'message_update',
    message: {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'call-1', name: 'read', arguments: {} }],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop',
      api: 'test',
      provider: 'test',
      model: 'test',
      timestamp: 0,
    },
    assistantMessageEvent: {
      type: 'toolcall_start',
      contentIndex: 0,
      partial: { content: [{ type: 'toolCall', id: 'call-1', name: 'read', arguments: {} }] },
    },
  } as unknown as AgentSessionEvent

  const json = toJsonEvent(event)
  assert.equal(json.type, 'message_update')
  if (json.type !== 'message_update')
    return
  assert.equal('partial' in json.assistantMessageEvent, false)
  assert.equal(json.assistantMessageEvent.type, 'toolcall_start')
  if (json.assistantMessageEvent.type === 'toolcall_start') {
    assert.equal(json.assistantMessageEvent.id, 'call-1')
    assert.equal(json.assistantMessageEvent.toolName, 'read')
  }
})
