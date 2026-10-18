import assert from 'node:assert/strict'
import { it } from 'node:test'
import { conductorDraftReady, mergeConductorDraft, parseConductorDraft, stripConductorFences } from '@piflow/protocol'

const current = {
  modules: [
    { id: 'login', name: '登录', brief: '已经写过' },
    { id: 'empty', name: '空说明', brief: '' },
    { id: 'kept', name: '保留', brief: '留着' },
  ],
  links: [{ id: 'old', source: 'login', target: 'kept' }],
}

it('reads the latest fenced draft and ignores the prose around it', () => {
  const text = [
    '先看仓库。',
    '```piflow-modules',
    '{"modules":[{"id":"old","name":"旧","brief":"旧"}],"links":[]}',
    '```',
    '再改一版。',
    '```piflow-modules',
    '{"modules":[{"id":"new:session","name":"会话","brief":"负责会话边界"}],"links":[]}',
    '```',
  ].join('\n')
  const draft = parseConductorDraft(text)
  assert.equal(draft?.modules[0]?.id, 'new:session')
  assert.equal(conductorDraftReady(draft!), true)
  assert.equal(parseConductorDraft('没有围栏'), null)
  const closed = stripConductorFences(text)
  assert.equal(parseConductorDraft(closed), null)
  assert.match(closed, /先看仓库/)
  assert.doesNotMatch(closed, /piflow-modules/)
  const open = '还在写\n```piflow-modules\n{"modules":[]}'
  assert.equal(stripConductorFences(open), open)
  assert.equal(parseConductorDraft(open), null)
})

it('accepts an isolated module and rejects a dangling link or an empty brief', () => {
  assert.equal(conductorDraftReady({
    modules: [{ id: 'new:one', name: '一个', brief: '单独负责' }],
    links: [],
  }), true)
  assert.equal(conductorDraftReady({
    modules: [{ id: 'new:one', name: '一个', brief: '   ' }],
    links: [],
  }), false)
  assert.equal(conductorDraftReady({
    modules: [{ id: 'new:one', name: '一个', brief: '单独负责' }],
    links: [{ source: 'new:one', target: 'missing' }],
  }), false)
})

it('keeps existing modules and only fills an empty brief', () => {
  const ids = ['m1', 'l1']
  const merged = mergeConductorDraft(current, {
    modules: [
      { id: 'login', name: '改名', brief: '想覆盖' },
      { id: 'empty', name: '空说明', brief: '补上的说明' },
      { id: 'new:session', name: '会话', brief: '负责会话边界' },
    ],
    links: [
      { source: 'login', target: 'new:session' },
      { source: 'new:session', target: 'login' },
    ],
  }, () => ids.shift() ?? 'extra')

  assert.deepEqual(merged?.modules.map(module => ({ id: module.id, name: module.name, brief: module.brief })), [
    { id: 'login', name: '登录', brief: '已经写过' },
    { id: 'empty', name: '空说明', brief: '补上的说明' },
    { id: 'kept', name: '保留', brief: '留着' },
    { id: 'm1', name: '会话', brief: '负责会话边界' },
  ])
  assert.deepEqual(merged?.links, [
    { id: 'old', source: 'login', target: 'kept' },
    { id: 'l1', source: 'login', target: 'm1' },
  ])
  assert.equal(mergeConductorDraft(current, {
    modules: [{ id: 'new:x', name: 'x', brief: '' }],
    links: [],
  }, () => 'nope'), null)
})
