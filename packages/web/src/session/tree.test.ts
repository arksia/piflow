/// <reference types="node" />
import type { SessionInfoLite } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildSessionForest,
  flattenSessionForest,
  MAX_TREE_INDENT,
  sessionAncestors,
  sessionLineage,
} from './tree'

function session(partial: Partial<SessionInfoLite> & { path: string }): SessionInfoLite {
  return {
    id: partial.path,
    cwd: '/project',
    name: null,
    parentSession: null,
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:00:00.000Z',
    messageCount: 1,
    firstMessage: partial.path,
    ...partial,
  }
}

describe('buildSessionForest', () => {
  it('sorts flat sessions by modified descending', () => {
    const forest = buildSessionForest([
      session({ path: 'old', modified: '2026-01-01T00:00:00.000Z' }),
      session({ path: 'new', modified: '2026-01-03T00:00:00.000Z' }),
      session({ path: 'mid', modified: '2026-01-02T00:00:00.000Z' }),
    ])
    assert.deepEqual(forest.map(node => node.session.path), ['new', 'mid', 'old'])
    assert.ok(forest.every(node => node.depth === 0 && node.children.length === 0))
  })

  it('nests children under their parent, newest first', () => {
    const forest = buildSessionForest([
      session({ path: 'root' }),
      session({ path: 'child-old', parentSession: 'root', modified: '2026-01-02T00:00:00.000Z' }),
      session({ path: 'child-new', parentSession: 'root', modified: '2026-01-03T00:00:00.000Z' }),
    ])
    assert.equal(forest.length, 1)
    const root = forest[0]
    assert.ok(root)
    assert.deepEqual(root.children.map(node => node.session.path), ['child-new', 'child-old'])
    assert.equal(root.children[0]?.depth, 1)
  })

  it('orders roots by latest activity anywhere in the subtree', () => {
    const forest = buildSessionForest([
      session({ path: 'stale-root', modified: '2026-01-10T00:00:00.000Z' }),
      session({ path: 'fresh-fork', parentSession: 'stale-root', modified: '2026-01-20T00:00:00.000Z' }),
      session({ path: 'lone-root', modified: '2026-01-15T00:00:00.000Z' }),
    ])
    assert.deepEqual(forest.map(node => node.session.path), ['stale-root', 'lone-root'])
    assert.equal(forest[0]?.subtreeModified, '2026-01-20T00:00:00.000Z')
  })

  it('promotes orphans whose parent is missing to roots', () => {
    const forest = buildSessionForest([
      session({ path: 'orphan', parentSession: 'deleted-parent' }),
    ])
    assert.equal(forest.length, 1)
    assert.equal(forest[0]?.session.path, 'orphan')
    assert.equal(forest[0]?.depth, 0)
  })
})

describe('flattenSessionForest', () => {
  function chain(depth: number): SessionInfoLite[] {
    const sessions: SessionInfoLite[] = []
    for (let index = 0; index < depth; index++)
      sessions.push(session({ path: `s${index}`, parentSession: index === 0 ? null : `s${index - 1}` }))
    return sessions
  }

  it('caps indent at MAX_TREE_INDENT for deep lineages', () => {
    const rows = flattenSessionForest(buildSessionForest(chain(MAX_TREE_INDENT + 2)), new Set())
    assert.deepEqual(rows.map(row => row.node.session.path), ['s0', 's1', 's2', 's3', 's4'])
    assert.deepEqual(rows.map(row => row.indent), [0, 1, 2, 3, 3])
  })

  it('hides descendants of collapsed nodes but keeps the node itself', () => {
    const rows = flattenSessionForest(buildSessionForest(chain(3)), new Set(['s0']))
    assert.deepEqual(rows.map(row => row.node.session.path), ['s0'])
    assert.equal(rows[0]?.hasChildren, true)
  })

  it('marks leaf nodes as childless', () => {
    const rows = flattenSessionForest(buildSessionForest(chain(2)), new Set())
    assert.equal(rows[0]?.hasChildren, true)
    assert.equal(rows[1]?.hasChildren, false)
  })
})

describe('sessionAncestors', () => {
  it('walks the parent chain nearest first', () => {
    const sessions = [
      session({ path: 'grandchild', parentSession: 'child' }),
      session({ path: 'child', parentSession: 'root' }),
      session({ path: 'root' }),
    ]
    assert.deepEqual(sessionAncestors(sessions, 'grandchild'), ['child', 'root'])
    assert.deepEqual(sessionAncestors(sessions, 'root'), [])
  })

  it('stops at a missing parent', () => {
    const sessions = [session({ path: 'orphan', parentSession: 'gone' })]
    assert.deepEqual(sessionAncestors(sessions, 'orphan'), [])
  })
})

describe('sessionLineage', () => {
  it('renders root-first lineage preferring names over first messages', () => {
    const sessions = [
      session({ path: 'child', parentSession: 'root', firstMessage: 'fork message' }),
      session({ path: 'root', name: '根会话' }),
    ]
    assert.equal(sessionLineage(sessions, 'child'), '根会话')
    assert.equal(sessionLineage(sessions, 'root'), null)
  })

  it('includes the whole chain for deep lineages', () => {
    const sessions = [
      session({ path: 'a' }),
      session({ path: 'b', parentSession: 'a' }),
      session({ path: 'c', parentSession: 'b' }),
    ]
    assert.equal(sessionLineage(sessions, 'c'), 'a → b')
  })
})
