import type { ReviewDetail } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { reviewScope } from '@piflow/protocol'

it('counts target identity once, excludes fully excluded targets, and never treats skipped as approved', () => {
  const target = (id: string, hunks = [id]) => ({ id, name: id, fileId: 'file', kind: 'function' as const, hunkIds: hunks })
  const value: Pick<ReviewDetail, 'targets' | 'decisions' | 'exclusions' | 'gaps'> = {
    targets: [target('unread'), target('unread'), target('excluded'), target('partial', ['excluded', 'partial']), target('requested'), target('seen'), target('skipped')],
    decisions: ['requested', 'seen', 'skipped'].map((id, i) => ({ targetId: id, state: (['changes-requested', 'seen', 'skipped'] as const)[i]!, note: '', updatedAt: '' })),
    exclusions: [{ hunkId: 'excluded', reason: 'out of scope' }],
    gaps: [{ id: 'source', kind: 'source-not-captured', source: 'host', explanation: 'binary' }, { id: 'docs', kind: 'document-missing', source: 'host', explanation: 'no PRD' }],
  }
  const scope = reviewScope(value)
  assert.deepEqual(scope.targets.map(target => target.id), ['unread', 'partial', 'requested', 'seen', 'skipped'])
  assert.deepEqual(scope.unread.map(target => target.id), ['unread', 'partial'])
  assert.deepEqual(scope.changesRequested.map(target => target.id), ['requested'])
  assert.equal(scope.seen.length, 1)
  assert.equal(scope.gaps.length, 1)
})
