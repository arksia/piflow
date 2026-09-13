import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reviewOpenByDefault, toolKind, toolPath, toolTarget } from './kind.ts'

test('toolKind uses a review label for known tools', () => {
  assert.equal(toolKind('read'), '读取')
  assert.equal(toolKind('bash'), '命令')
  assert.equal(toolKind('custom_tool'), 'custom_tool')
})

test('toolTarget prefers a single reviewable argument', () => {
  assert.equal(toolTarget({ path: 'src/a.ts', command: 'ls' }), 'ls')
  assert.equal(toolTarget({ path: 'src/a.ts' }), 'src/a.ts')
  assert.equal(toolPath({ path: 'src/a.ts' }), 'src/a.ts')
  assert.equal(toolPath({ path: 1 }), null)
})

test('reviewOpenByDefault only shouts for failures and diffs', () => {
  assert.equal(reviewOpenByDefault('error', false), true)
  assert.equal(reviewOpenByDefault('done', true), true)
  assert.equal(reviewOpenByDefault('done', false), false)
  assert.equal(reviewOpenByDefault('running', false), false)
})
