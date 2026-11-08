import type { ReviewDetail } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { diffRows, reviewGroups } from './review-model'
import { createReviewReader, receiveReview } from './review-reader'

function detail(version = 1, revision = 'rev'): ReviewDetail {
  return { review: { id: 'review', projectPath: '/project', title: 'Feature', revisionId: 'rev', version, runIds: ['run'], createdAt: '', updatedAt: '' }, revision: { id: revision, createdAt: '', fileCount: 1 }, revisions: [], files: [{ id: 'file', path: 'a.ts', status: 'modified', added: 1, removed: 1, hunkIds: ['h'], targetIds: ['a', 'b'], languageSupported: true }], targets: ['a', 'b'].map(id => ({ id, fileId: 'file', name: id, kind: 'function', hunkIds: ['h'] })), documents: [], evidence: [], gaps: [], route: null, decisions: [], unassignedHunkIds: ['h'], generation: { state: 'idle' } }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
it('ignores late revision responses, reconnects without model calls and rejects scoped/older data', async () => {
  const slow = deferred<ReviewDetail>()
  const seen: string[] = []
  let first = true
  let version = 2
  let wrong = false
  const reader = createReviewReader('/project', 'run', async <T>(url: string): Promise<T> => {
    seen.push(url)
    if (url.includes('/api/runs'))
      return { reviewId: 'review', reason: null } as T
    if (first) {
      first = false
      return slow.promise as Promise<T>
    }
    const value = detail(version, new URL(url, 'http://local').searchParams.get('revisionId') ?? 'rev')
    if (wrong)
      value.review.projectPath = '/other'
    return value as T
  })
  reader.open()
  const initial = reader.refresh()
  await new Promise(resolve => setTimeout(resolve, 0))
  void reader.selectRevision('old')
  slow.resolve(detail(1))
  await initial
  assert.equal(reader.getSnapshot().detail?.revision.id, 'old')
  receiveReview({ type: 'review_updated', projectPath: '/other', reviewId: 'review', revisionId: 'rev', version: 1000 })
  receiveReview({ type: 'review_updated', projectPath: '/project', reviewId: 'unrelated', revisionId: 'rev', version: 1000 })
  await reader.selectRevision()
  assert.equal(reader.getSnapshot().detail?.revision.id, 'rev')
  version = 1
  await reader.refresh()
  assert.match(reader.getSnapshot().error!, /版本落后/)
  assert.equal(reader.getSnapshot().detail?.review.version, 2)
  version = 3
  wrong = true
  await reader.refresh()
  assert.match(reader.getSnapshot().error!, /身份/)
  wrong = false
  await reader.refresh()
  assert.equal(reader.getSnapshot().detail?.review.version, 3)
  reader.close()
  assert.ok(seen.every(url => !url.includes('generate')))
})
it('does not publish a response after close and retains one decision across shared route targets', async () => {
  const pending = deferred<ReviewDetail>()
  const reader = createReviewReader('/project', 'run', async <T>(url: string): Promise<T> => url.includes('/api/runs') ? { reviewId: 'review', reason: null } as T : pending.promise as Promise<T>)
  reader.open()
  const loading = reader.refresh()
  await new Promise(resolve => setTimeout(resolve, 0))
  reader.close()
  pending.resolve(detail())
  await loading
  assert.equal(reader.getSnapshot().detail, null)
  const value = detail()
  const step = { key: 'one', title: 'First', purpose: 'Read', requirementIds: [], designSectionIds: [], adrIds: [], evidenceIds: [], targets: [{ targetId: 'a', reason: 'x', reviewFocus: 'y' }] }
  value.route = { version: 1, source: 'agent', value: { schemaVersion: 1, revisionToken: 'token', summary: '', steps: [step, { ...step, key: 'two' }], relations: [], gaps: [] } }
  value.decisions = [{ targetId: 'a', state: 'seen', note: '', updatedAt: '' }]
  assert.deepEqual(reviewGroups(value, 'flow').map(g => g.targetIds), [['a'], ['a'], ['b']])
  assert.deepEqual(reviewGroups(value, 'files')[0]!.targetIds, ['a', 'b'])
  const rows = diffRows([{ id: 'h', oldStart: 10, newStart: 12, oldLines: 2, newLines: 2, lines: [' same', '-old', '+new', '\\ No newline at end of file'] }])
  assert.deepEqual(rows.slice(1).map(r => [r.old, r.next]), [[10, 12], [11, null], [null, 13], [null, null]])
})
