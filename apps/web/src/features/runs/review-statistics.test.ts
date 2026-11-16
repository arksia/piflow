import type { ReviewDetail, ReviewFile, ReviewFileStatistics } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { reviewGroups, reviewStatistics, statisticsMatches } from './review-model'

function fixture(): ReviewDetail {
  const stats: ReviewFileStatistics = { addedHunkIds: ['ha'], removedHunkIds: ['hd'], functionState: 'complete', testState: 'not-applicable', changes: [{ name: 'newFunction', kind: 'function', change: 'added', hunkIds: ['ha'], targetIds: ['a'] }, { name: 'gone', kind: 'method', change: 'deleted', hunkIds: ['hd'], targetIds: ['d'] }, { name: 'callback', kind: 'callback', change: 'unmatched', hunkIds: ['ha'], targetIds: ['a'] }], notes: [] }
  const file: ReviewFile = { id: 'code', path: 'src/code.ts', status: 'modified', added: 10, removed: 4, hunkIds: ['ha', 'hd'], targetIds: ['a', 'd'], languageSupported: true, statistics: stats }
  const step = { key: 'one', title: 'One', purpose: '', requirementIds: [], designSectionIds: [], adrIds: [], evidenceIds: [], targets: [{ targetId: 'a', reason: '', reviewFocus: '' }] }
  return { review: { id: 'review', projectPath: '/p', title: '', revisionId: 'rev', version: 1, runIds: [], createdAt: '', updatedAt: '' }, revision: { id: 'rev', createdAt: '', fileCount: 3 }, revisions: [], files: [file, { ...file, id: 'test', path: 'src/test/code.ts', hunkIds: ['ht'], targetIds: ['t'], added: 7, removed: 0, statistics: { ...stats, addedHunkIds: ['ht'], removedHunkIds: [], testState: 'partial', changes: [{ name: 'handles zero', kind: 'test', change: 'added', hunkIds: ['ht'], targetIds: ['t'] }], notes: ['Dynamic tests'] } }, { ...file, id: 'old', path: 'docs/readme.md', added: 1, removed: 2, hunkIds: ['ho'], targetIds: ['o'], statistics: undefined }], targets: [{ id: 'a', fileId: 'code', name: 'newFunction', kind: 'function', hunkIds: ['ha'] }, { id: 'd', fileId: 'code', name: 'gone', kind: 'function', hunkIds: ['hd'] }, { id: 't', fileId: 'test', name: 'callback', kind: 'function', hunkIds: ['ht'] }, { id: 'o', fileId: 'old', name: 'file', kind: 'file', hunkIds: ['ho'] }], documents: [], evidence: [], gaps: [], route: { version: 1, source: 'user', value: { schemaVersion: 1, revisionToken: 'token', summary: '', steps: [step, { ...step, key: 'two' }], relations: [], gaps: [] } }, decisions: [{ targetId: 'a', state: 'seen', note: '', updatedAt: '' }], exclusions: [{ hunkId: 'hd', reason: 'out of scope' }], unassignedHunkIds: ['ht', 'ho'], generation: { state: 'idle' } }
}
it('counts revision files once despite shared steps and exclusions, distinguishes callbacks and missing history', () => {
  const detail = fixture()
  const [code, tests, other] = reviewStatistics(detail)
  assert.deepEqual([code!.fileCount, code!.added, code!.removed, code!.functions.length, code!.callbacks.length], [1, 10, 4, 2, 1])
  assert.equal(tests!.tests.length, 1)
  assert.equal(tests!.incompleteTests, true)
  assert.equal(other!.functionFiles, 0)
  assert.equal(other!.incompleteFunctions, true)
  assert.match(other!.notes.join(''), /历史/)
  const before = JSON.stringify(detail)
  const filter = { category: 'implementation', metric: 'functions', change: 'added' } as const
  assert.deepEqual(reviewGroups(detail, 'flow', filter).map(g => g.targetIds), [['a'], ['a']])
  assert.deepEqual(reviewGroups(detail, 'files', filter).map(g => g.targetIds), [['a']])
  assert.deepEqual(statisticsMatches(detail, filter).get('code'), { hunkIds: ['ha'], targetIds: ['a'] })
  assert.equal(JSON.stringify(detail), before)
})
it('filters added/deleted hunks and tests without borrowing unavailable function counts', () => {
  const detail = fixture()
  const filter = { category: 'implementation', metric: 'removed-lines' } as const
  assert.deepEqual(statisticsMatches(detail, filter).get('code')!.hunkIds, ['hd'])
  assert.deepEqual(reviewGroups(detail, 'files', filter)[0]!.targetIds, ['d'])
  assert.deepEqual(reviewGroups(detail, 'files', { category: 'test', metric: 'tests', change: 'added' })[0]!.targetIds, ['t'])
  assert.equal(reviewGroups(detail, 'files', { category: 'other', metric: 'functions', change: 'added' }).length, 0)
  assert.equal(reviewStatistics(detail)[0]!.functions.length, 2)
  detail.files[0]!.statistics!.changes.push({ name: 'ambiguous', kind: 'function', change: 'unmatched', hunkIds: ['ha'], targetIds: ['a'] })
  assert.equal(reviewStatistics(detail)[0]!.incompleteFunctions, true)
})
