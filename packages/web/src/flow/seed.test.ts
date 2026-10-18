import assert from 'node:assert/strict'
import { it } from 'node:test'
import { shouldSeedFlow } from './seed'

const openSession = { nodeCount: 0, seedPath: 'session-a', seedCwd: '/project', projectPath: '/project' }

it('puts the open session on a canvas that has never been saved', () => {
  assert.equal(shouldSeedFlow({ stored: false, ...openSession }), true)
})

it('leaves a canvas empty after its nodes were removed', () => {
  assert.equal(shouldSeedFlow({ stored: true, ...openSession }), false)
})

it('does not seed a session from another project', () => {
  assert.equal(shouldSeedFlow({ stored: false, ...openSession, seedCwd: '/other' }), false)
})
