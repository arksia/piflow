import assert from 'node:assert/strict'
import { it } from 'node:test'
import { readFlowProject, saveFlowProject } from './workspace'

it('remembers the Flow project independently of the active chat', () => {
  const previous = globalThis.localStorage
  const values = new Map<string, string>([['piflow.active', 'chat-a']])
  globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } as unknown as Storage
  try {
    assert.equal(readFlowProject(), '')
    saveFlowProject('/flow-project')
    values.set('piflow.active', 'chat-b')
    assert.equal(readFlowProject(), '/flow-project')
    assert.equal(values.get('piflow.active'), 'chat-b')
  }
  finally {
    globalThis.localStorage = previous
  }
})
