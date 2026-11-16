import assert from 'node:assert/strict'
import { it } from 'node:test'
import { readFlowProject, readFlowView, saveFlowProject, saveFlowView } from './workspace'

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

it('scopes group views to a project and rejects corrupt geometry without blocking navigation', () => {
  const previous = globalThis.localStorage
  const values = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } as unknown as Storage
  try {
    const view = { teamId: 'a', groups: { a: { positions: { role: { x: 20, y: 40 } }, viewport: { x: 10, y: 30, zoom: 0.8 } } } }
    saveFlowView('/first', view)
    assert.deepEqual(readFlowView('/first'), view)
    assert.deepEqual(readFlowView('/other'), { teamId: null, groups: {} })
    values.set('piflow.flow-view:1:/first', '{broken')
    assert.deepEqual(readFlowView('/first'), { teamId: null, groups: {} })
    values.set('piflow.flow-view:1:/first', JSON.stringify({ teamId: 'a', groups: { a: { positions: { broken: { x: null, y: 4 } }, viewport: { x: 0, y: 0, zoom: -1 } } } }))
    assert.deepEqual(readFlowView('/first'), { teamId: 'a', groups: { a: { positions: {} } } })
    globalThis.localStorage.setItem = () => {
      throw new Error('storage unavailable')
    }
    assert.doesNotThrow(() => saveFlowView('/first', view))
  }
  finally {
    globalThis.localStorage = previous
  }
})
