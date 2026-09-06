import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { JsonAgentSessionEvent } from '@earendil-works/pi-coding-agent'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { applyAssistantUpdate, applyStatusDelta, clearSessionUnread, handleEvent, route } from './reducer'
import { store } from './store'

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

it('tracks completion attention per background session and clears it on open', () => {
  const values = new Map<string, string>()
  Object.assign(globalThis, {
    document: { hidden: false },
    requestAnimationFrame: (callback: () => void) => { callback(); return 1 },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  })
  store.activeKey = '/project/active.jsonl'
  store.statuses = {}
  store.unreadSessions = new Set()
  applyStatusDelta({ key: '/project/background.jsonl', sessionFile: '/project/background.jsonl', status: 'running', needsInputAt: null, updatedAt: '2026-01-01T00:00:00.000Z' })
  applyStatusDelta({ key: '/project/background.jsonl', sessionFile: '/project/background.jsonl', status: 'idle', needsInputAt: null, updatedAt: '2026-01-01T00:00:01.000Z' })
  assert.deepEqual([...store.unreadSessions], ['/project/background.jsonl'])
  applyStatusDelta({ key: '/project/other.jsonl', sessionFile: '/project/other.jsonl', status: 'failed', needsInputAt: null, updatedAt: '2026-01-01T00:00:02.000Z' })
  assert.equal(store.statuses['/project/background.jsonl']?.status, 'idle')
  assert.equal(store.statuses['/project/other.jsonl']?.status, 'failed')
  clearSessionUnread('/project/background.jsonl')
  assert.deepEqual([...store.unreadSessions], [])
})

it('keeps provider errors scoped to their session', () => {
  store.views = {}
  route({ type: 'error', session: 'session-a', error: 'provider failed' }, () => {})
  route({ type: 'error', session: 'session-b', error: 'tool failed' }, () => {})
  assert.equal(store.views['session-a']?.error, 'provider failed')
  assert.equal(store.views['session-b']?.error, 'tool failed')
})

it('replaces tool results on replay instead of duplicating them', () => {
  store.views = {}
  handleEvent('session-a', { type: 'tool_execution_end', toolCallId: 'call-1', toolName: 'read', result: { content: 'failed' }, isError: true })
  handleEvent('session-a', { type: 'tool_execution_end', toolCallId: 'call-1', toolName: 'read', result: { content: 'replayed' }, isError: false })
  assert.deepEqual(store.views['session-a']?.toolResults, {
    'call-1': { result: { content: 'replayed' }, isError: false },
  })
})
