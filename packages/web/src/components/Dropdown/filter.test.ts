import assert from 'node:assert/strict'
import { it } from 'node:test'
import { filterDropdownItems } from './filter'

const items = [
  { key: 'main', label: 'main' },
  {
    key: 'model',
    label: '模型',
    children: [
      { key: 'kimi', label: 'kimi-for-coding' },
      { key: 'gpt', label: 'gpt' },
    ],
  },
]

it('keeps the full list until there is a query', () => {
  assert.equal(filterDropdownItems(items, '  '), items)
})

it('keeps a parent when only a child matches', () => {
  assert.deepEqual(filterDropdownItems(items, 'KIMI'), [
    {
      key: 'model',
      label: '模型',
      children: [{ key: 'kimi', label: 'kimi-for-coding' }],
    },
  ])
})

it('keeps every child when the parent label matches', () => {
  assert.deepEqual(filterDropdownItems(items, '模型'), [items[1]])
})
