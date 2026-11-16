/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { visibleTreeRows } from './tree'

interface Item { id: string, children: Item[] }
const items: Item[] = [{ id: 'parent', children: [{ id: 'child', children: [{ id: 'grandchild', children: [] }] }] }, { id: 'other', children: [] }]
const key = (item: Item) => item.id
const children = (item: Item) => item.children

test('collapse hides descendants, reopening preserves their own collapsed state', () => {
  const collapsed = new Set(['parent', 'child'])
  assert.deepEqual(visibleTreeRows(items, collapsed, key, children).map(row => row.id), ['parent', 'other'])
  collapsed.delete('parent')
  assert.deepEqual(visibleTreeRows(items, collapsed, key, children).map(row => row.id), ['parent', 'child', 'other'])
  collapsed.delete('child')
  assert.deepEqual(visibleTreeRows(items, collapsed, key, children).map(row => row.id), ['parent', 'child', 'grandchild', 'other'])
})

test('caps visual indentation while preserving real parent navigation and leaf identity', () => {
  const rows = visibleTreeRows(items, new Set(), key, children, 1)
  assert.deepEqual(rows.map(row => [row.id, row.parentId, row.depth, row.hasChildren]), [
    ['parent', undefined, 0, true],
    ['child', 'parent', 1, true],
    ['grandchild', 'child', 1, false],
    ['other', undefined, 0, false],
  ])
})
