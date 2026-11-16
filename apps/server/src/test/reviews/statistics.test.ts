import assert from 'node:assert/strict'
import { it } from 'node:test'
import { reviewFileCategory } from '@piflow/protocol'
import { compareSources } from '../../reviews/analysis.ts'

function compare(path: string, before: string, after: string) {
  const base = { id: 'before', root: '/repo', head: null, capturedAt: '', files: { [path]: 'old' }, omitted: [], complete: true }
  return compareSources(base, { ...base, id: 'after', files: { [path]: 'new' } }, hash => hash === 'old' ? before : after)
}
function changes(path: string, before: string, after: string) {
  return compare(path, before, after).files[0]!.statistics!
}
it('pairs full indexes for insertion-only edits and ignores unchanged functions shifted by lines', () => {
  const old = `export function first() {\n  return 1\n}\nexport function unchanged() { return 2 }\nclass Service {\n  work() { return 3 }\n  gone() { return 4 }\n}\n`
  const next = `export function added() { return 0 }\nexport function first() {\n  console.log('trace')\n  return 1\n}\nexport function unchanged() { return 2 }\nclass Service {\n  work() { return 5 }\n  fresh() { return 6 }\n}\n`
  const result = changes('code.ts', old, next)
  assert.equal(result.functionState, 'complete')
  assert.deepEqual(result.changes.map(c => [c.name, c.kind, c.change]).sort(), [
    ['first', 'function', 'modified'],
    ['added', 'function', 'added'],
    ['Service › work', 'method', 'modified'],
    ['Service › gone', 'method', 'deleted'],
    ['Service › fresh', 'method', 'added'],
  ].sort())
  assert.ok(result.changes.every(c => c.targetIds.length && c.hunkIds.length))
  assert.ok(result.addedHunkIds.length)
})
it('keeps anonymous callbacks and ambiguous declarations out of exact added/deleted counts', () => {
  const old = `items.map(x => x + 1)\nfunction duplicate() { return 1 }\nfunction duplicate() { return 2 }\n`
  const next = `// moved\nitems.map(x => x + 1)\nfunction duplicate() { return 1 }\nfunction duplicate() { return 3 }\n`
  const result = changes('code.ts', old, next)
  assert.equal(result.changes.some(c => c.kind === 'callback'), false)
  assert.ok(result.changes.some(c => c.name === 'duplicate' && c.change === 'unmatched'))
  assert.ok(!result.changes.some(c => c.name === 'duplicate' && c.change !== 'unmatched'))
  const callbacks = changes('code.ts', 'items.map(x => x + 1)\n', 'items.map(x => x + 2)\n').changes
  assert.ok(callbacks.every(c => c.kind === 'callback' && c.change === 'unmatched'))
})
it('counts static tests with aliases, suites and parameterized templates separately from helper functions', () => {
  const old = `import { test as check, describe } from 'node:test'\ndescribe('one', () => {\n  check('same', () => { assert.equal(1, 1) })\n})\ndescribe('two', () => {\n  check('same', () => { assert.equal(2, 2) })\n})\ncheck.todo('removed')\nfunction helper() { return 1 }\n`
  const next = `import { test as check, describe } from 'node:test'\ndescribe('one', () => {\n  check('same', () => { assert.equal(1, 0) })\n})\ndescribe('two', () => {\n  check('same', () => { assert.equal(2, 2) })\n})\ncheck.skip('new', () => {})\nfunction helper() { return 2 }\n`
  const result = changes('src/test/example.test.ts', old, next)
  assert.deepEqual(result.changes.filter(c => c.kind === 'test').map(c => [c.name, c.change]).sort(), [['one › same', 'modified'], ['removed', 'deleted'], ['new', 'added']].sort())
  assert.deepEqual(result.changes.filter(c => c.kind === 'function').map(c => [c.name, c.change]), [['helper', 'modified']])
  const templates = changes('unit.spec.ts', '', `import { test } from 'vitest'\ntest.each([1, 2, 3])('template %i', value => {})\ntest.each\`a | b\n1 | 2\`('tagged', () => {})\n`)
  assert.equal(templates.changes.filter(c => c.kind === 'test').length, 2)
  assert.equal(templates.testState, 'complete')
  const commonjs = changes('unit.test.cjs', '', `const { test: check, describe: suite } = require('node:test')\nsuite('group', () => { check('case', () => {}) })\n`)
  assert.deepEqual(commonjs.changes.filter(c => c.kind === 'test').map(c => c.name), ['group › case'])
  const unsupported = changes('unit.spec.ts', '', `test.skipIf(condition)('case', () => {})\n`)
  assert.equal(unsupported.testState, 'partial')
})
it('withholds dynamic and shadowed test identities, supports namespaces, and exposes unavailable analysis', () => {
  const dynamic = changes('sample.test.ts', '', `import * as unit from 'node:test'\nunit.test('fixed', () => {})\nunit.it(title, () => {})\n`)
  assert.equal(dynamic.testState, 'partial')
  assert.deepEqual(dynamic.changes.filter(c => c.kind === 'test').map(c => c.change), ['added', 'unmatched'])
  const shadow = changes('sample.test.ts', '', `function test(name: string) {}\ntest('ordinary helper')\n`)
  assert.equal(shadow.changes.filter(c => c.kind === 'test').length, 0)
  assert.equal(shadow.testState, 'partial')
  const syntax = compare('broken.ts', 'function f() { return 1 }', 'function f( {')
  assert.equal(syntax.files[0]!.statistics!.functionState, 'unavailable')
  assert.ok(syntax.gaps.some(g => g.kind === 'symbol-budget'))
  assert.equal(changes('unit_test.py', '', 'def test_one(): pass\n').functionState, 'unavailable')
  assert.equal(changes('docs/design/feature.md', '', '# Design\n').functionState, 'not-applicable')
  assert.equal(reviewFileCategory('packages/server/src/test/reviews/example.ts'), 'test')
  assert.equal(reviewFileCategory('a.test.tsx'), 'test')
  assert.equal(reviewFileCategory('test_math.py'), 'test')
  assert.equal(reviewFileCategory('math_test.go'), 'test')
  assert.equal(reviewFileCategory('src/example.ts'), 'implementation')
  assert.equal(reviewFileCategory('pnpm-lock.yaml'), 'other')
})

it('reports renames as text additions/deletions and excludes type-only signatures from executable functions', () => {
  const result = changes('source.ts', `interface Port { work(): void }\nfunction overload(value: string): string;\nfunction overload(value: unknown) { return value }\nfunction oldName() { return 1 }\n`, `interface Port { work(value: string): void }\nfunction overload(value: string): string;\nfunction overload(value: unknown) { return value }\nfunction newName() { return 1 }\n`)
  assert.deepEqual(result.changes.map(c => [c.name, c.change]), [['oldName', 'deleted'], ['newName', 'added']])
})

it('keeps renamed tests as distinct review objects while pairing same-name test callbacks across edits', () => {
  const renamed = compare('unit.test.ts', `test('old', () => { return 1 })\n`, `test('new', () => { return 2 })\n`)
  assert.deepEqual(renamed.targets.map(t => t.name), ['test: old', 'test: new'])
  assert.ok(renamed.targets[0]!.oldStart && !renamed.targets[0]!.newStart)
  assert.ok(renamed.targets[1]!.newStart && !renamed.targets[1]!.oldStart)
  const edited = compare('unit.test.ts', `test('same', () => { return 1 })\n`, `test('same', () => { return 2 })\n`)
  assert.equal(edited.targets.length, 1)
  assert.equal(edited.targets[0]!.name, 'test: same')
  assert.equal(edited.files[0]!.statistics!.changes.find(c => c.kind === 'test')!.change, 'modified')
})

it('counts executable class fields/default exports while keeping named test callbacks separate', () => {
  const result = changes('feature.test.ts', '', `class Example { action = () => 1; get value() { return 2 } }\nexport default () => 3\ntest('named callback', function handler() { return 4 })\n`)
  assert.deepEqual(result.changes.filter(c => c.kind !== 'callback' && c.kind !== 'test').map(c => [c.name, c.kind]), [['Example › action', 'method'], ['Example › get value', 'method'], ['default', 'function']])
  assert.equal(result.changes.find(c => c.name === 'test: named callback')!.kind, 'callback')
})
