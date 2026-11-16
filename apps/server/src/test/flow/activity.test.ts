import type { ReviewMessage, RunDetail } from '@piflow/protocol'
import type { Reviews } from '../../reviews/index.ts'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { promisify } from 'node:util'
import { readFlowActivity } from '../../flow/activity.ts'
import { createReviews } from '../../reviews/index.ts'
import { openRunStore } from '../../runs/store.ts'

const exec = promisify(execFile)
function run(projectPath: string, id: string, roleId = id, orchestratorId = 'a', status: RunDetail['status'] = 'succeeded', time = '2026-11-10T01:00:00Z'): RunDetail {
  return { id, projectPath, roleId, roleName: roleId, orchestratorId, orchestratorName: orchestratorId, task: 'private task body', taskPreview: id, status, createdAt: time, revision: 1, outputRevision: 0, toolCount: 0, failedToolCount: 0, lastObservedAt: time, parentSessionPath: '/session', parentToolCallId: 'tool', configurationSnapshot: { cwd: projectPath, roleName: roleId, effectivePrompt: 'private', model: 'provider/model', thinkingLevel: 'off', tools: [], memberRoleIds: [] }, historyAvailability: 'recorded', diagnostics: [] }
}
it('observes all records, purpose-aware latest runs and only the current revision source, with scoped paging', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-activity-')))
  const project = join(root, 'project')
  await mkdir(project)
  const git = (...args: string[]) => exec('git', ['-C', project, ...args])
  await git('init', '-q')
  await git('config', 'user.email', 'test@example.invalid')
  await git('config', 'user.name', 'Test')
  await writeFile(join(project, 'code.ts'), 'export function task() { return 1 }\n')
  await git('add', '.')
  await git('commit', '-qm', 'base')
  const store = await openRunStore(join(root, 'data'))
  const events: ReviewMessage[] = []
  const reviews = await createReviews({ dataDir: join(root, 'data'), publish: event => events.push(event) })
  const runs = { activity: async (path: string, ids: string[] = []) => store.activity(path, ids) }
  try {
    for (let i = 0; i < 1100; i++) store.insert(run(project, `history-${i}`, 'history'))
    for (let i = 0; i < 25; i++) store.insert(run(project, `failed-${i}`, `role-${i}`, 'a', 'failed'))
    store.insert(run(project, 'prior-failure', 'retried', 'a', 'failed'))
    store.insert(run(project, 'retry-success', 'retried', 'a', 'succeeded', '2026-11-10T02:00:00Z'))
    store.insert(run(project, 'active-one', 'parallel', 'a', 'running'))
    store.insert(run(project, 'active-two', 'parallel', 'a', 'running'))
    const analysis = run(project, 'analysis', 'parallel', 'a', 'failed')
    analysis.configurationSnapshot.reviewAnalysis = { reviewId: 'r', revisionId: 'v', bundlePath: 'private' }
    store.insert(analysis)
    const laterAnalysis = run(project, 'analysis-new', 'parallel', 'a', 'failed', '2026-11-10T02:00:00Z')
    laterAnalysis.configurationSnapshot.reviewAnalysis = { reviewId: 'r2', revisionId: 'v2', bundlePath: 'other' }
    store.insert(laterAnalysis)
    store.insert(run(project, 'cancel', 'cancel', 'a', 'cancelled'))
    store.insert(run('/foreign', 'foreign'))
    store.insert(run(project, 'source-a', 'coder', 'a'))
    store.insert(run(project, 'source-b', 'coder', 'b'))
    await reviews.captureBefore('source-a', project, project)
    await writeFile(join(project, 'code.ts'), 'export function task() { return 2 }\n')
    await reviews.captureAfter('source-a', project, project, 'Feature', true)
    const id = reviews.forRun(project, 'source-a').reviewId!
    const initial = reviews.read(project, id)
    const target = initial.targets[0]!
    reviews.decide(project, id, initial.revision.id, { targetId: target.id, state: 'changes-requested', note: 'fix' })
    let page = await readFlowActivity({ projectPath: project }, runs, reviews)
    assert.equal(page.totals.changesRequested, 1)
    reviews.exclude(project, id, initial.revision.id, target.hunkIds, 'outside')
    assert.equal(reviews.attention(project)[0]?.changesRequested, 0)
    reviews.exclude(project, id, initial.revision.id, target.hunkIds, null)
    await reviews.captureBefore('source-b', project, project, undefined, id)
    await writeFile(join(project, 'code.ts'), 'export function task() { return 3 }\n')
    await reviews.captureAfter('source-b', project, project, 'Feature', true)
    page = await readFlowActivity({ projectPath: project }, runs, reviews)
    assert.equal(page.totals.running, 2)
    assert.equal(page.totals.latestFailures, 26)
    assert.equal(page.totals.cancelled, 1)
    assert.equal(page.totals.pendingReviews, 1)
    assert.equal(page.totals.changesRequested, 0)
    assert.equal(page.groups.find(group => group.orchestratorId === 'a')?.counts.pendingReviews, 0)
    assert.equal(page.groups.find(group => group.orchestratorId === 'b')?.counts.pendingReviews, 1)
    assert.equal(page.items.length, 20)
    assert.ok(page.nextCursor)
    const more = await readFlowActivity({ projectPath: project, cursor: page.nextCursor! }, runs, reviews)
    assert.ok(more.items.length)
    assert.ok(more.items.every(item => !page.items.some(first => first.id === item.id)))
    assert.equal(more.totals.pendingReviews, page.totals.pendingReviews)
    await assert.rejects(readFlowActivity({ projectPath: project, orchestratorId: 'b', cursor: page.nextCursor! }, runs, reviews), /游标/)
    await assert.rejects(readFlowActivity({ projectPath: '/foreign', cursor: page.nextCursor! }, runs, reviews), /游标/)
    const filtered = await readFlowActivity({ projectPath: project, orchestratorId: 'b', kind: 'pending-review' }, runs, reviews)
    assert.equal(filtered.items.length, 1)
    assert.equal(filtered.items[0]?.target.kind, 'review')
    const facts = store.activity(project, ['foreign', 'source-a'])
    assert.deepEqual(facts.sources.map(item => item.id), ['source-a'])
    assert.equal(facts.latestRuns.filter(item => item.roleId === 'parallel').length, 2)
    assert.equal('configurationSnapshot' in facts.sources[0]!, false)
    assert.equal('task' in facts.sources[0]!, false)
    const began = performance.now()
    await readFlowActivity({ projectPath: project }, runs, reviews)
    t.diagnostic(`1136+ Run metadata observation: ${(performance.now() - began).toFixed(1)}ms`)
    reviews.remove(project, id)
    assert.equal(events.at(-1)?.type, 'review_removed')
    assert.equal(reviews.attention(project).length, 0)
    assert.throws(() => reviews.read(project, id), /不存在/)
  }
  finally {
    reviews.close()
    await store.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('separates manual, missing-source and still-collecting deliveries without hiding gaps', async () => {
  const source = run('/project', 'collecting', 'coder', 'owner', 'running')
  source.progress = { phase: 'collecting' }
  const fact = (id: string, sourceRunId?: string): ReturnType<Reviews['attention']>[number] => ({
    review: { id, projectPath: '/project', title: id, revisionId: `rev-${id}`, version: 3, runIds: ['historic-source'], createdAt: '', updatedAt: '2026-11-10T00:00:00Z' },
    sourceRunId,
    unread: 1,
    changesRequested: 0,
    gaps: 0,
    firstUnreadId: 'target',
    firstRequestedId: undefined,
    gapReasons: [],
    generation: { state: 'failed' },
  })
  const observations = [fact('manual'), fact('missing', 'absent'), fact('collecting', source.id), { ...fact('gap'), unread: 0, gaps: 2, gapReasons: ['binary file', 'capture budget'] }]
  const page = await readFlowActivity({ projectPath: '/project' }, { activity: async () => ({ activeRuns: [source], latestRuns: [source], sources: [source] }) }, { attention: () => observations })
  assert.equal(page.totals.running, 1)
  assert.equal(page.totals.pendingReviews, 1)
  assert.equal(page.totals.inProgressReviews, 1)
  assert.equal(page.totals.unavailableReviews, 1)
  assert.equal(page.totals.uncoveredChanges, 2)
  assert.equal(page.groups.find(item => item.orchestratorId === null)?.counts.pendingReviews, 1)
  assert.equal(page.groups.find(item => item.orchestratorId === 'owner')?.counts.pendingReviews, 0)
  const manual = page.items.find(item => item.id === 'pending-review:manual')!
  assert.deepEqual(manual.target, { kind: 'review', reviewId: 'manual', revisionId: 'rev-manual', minimumVersion: 3, targetId: 'target' })
  assert.equal(page.items.some(item => item.id === 'pending-review:missing'), false)
  assert.equal(page.items.some(item => item.id === 'pending-review:collecting'), false)
  assert.match(page.items.find(item => item.id === 'running:collecting')!.description, /整理证据/)
  assert.match(page.items.find(item => item.kind === 'evidence-gap')!.description, /binary file；capture budget/)
})
