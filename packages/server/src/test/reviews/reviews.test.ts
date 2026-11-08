import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { promisify } from 'node:util'
import { compareSources, sourceDocuments } from '../../reviews/analysis'
import { createReviews } from '../../reviews/index'
import { captureSource } from '../../reviews/source'

const exec = promisify(execFile)
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-review-')))
  const cwd = join(root, 'repo')
  await mkdir(join(cwd, 'docs', 'requirements'), { recursive: true })
  await mkdir(join(cwd, 'docs', 'design'), { recursive: true })
  await mkdir(join(cwd, 'docs', 'adr'), { recursive: true })
  const git = (...args: string[]) => exec('git', ['-C', cwd, ...args])
  await git('init', '-q')
  await git('config', 'user.email', 'test@example.invalid')
  await git('config', 'user.name', 'Test')
  await writeFile(join(cwd, '.gitignore'), 'ignored.txt\n')
  await writeFile(join(cwd, 'code.ts'), 'export function calculate() {\n  return 1\n}\n')
  await writeFile(join(cwd, 'docs/requirements/code.md'), '# REQ-CODE: Example\n\n## AC-CODE-UNKNOWN: Unknown\nKeep unknown.\n')
  await writeFile(join(cwd, 'docs/design/code.md'), '# DESIGN-CODE: Example\n\nPersist values.\n')
  await writeFile(join(cwd, 'docs/adr/0001-example.md'), '# Record facts\nKeep facts distinct.\n')
  await git('add', '.')
  await git('commit', '-qm', 'base')
  return { root, cwd, git }
}
it('captures actual dirty baselines, staged and unusual untracked paths without following symlinks', async () => {
  const f = await fixture()
  const contents = new Map<string, string>()
  const put = (hash: string, text: string) => {
    contents.set(hash, text)
  }
  try {
    await writeFile(join(f.cwd, 'code.ts'), 'export function calculate() {\n  return 2\n}\n')
    const before = await captureSource(f.cwd, put)
    await writeFile(join(f.cwd, 'code.ts'), 'export function calculate() {\n  return 3\n}\n')
    await f.git('add', 'code.ts')
    await writeFile(join(f.cwd, 'line\nquote".sql'), 'SELECT 1;\n')
    await writeFile(join(f.cwd, 'ignored.txt'), 'private')
    await writeFile(join(f.root, 'outside'), 'secret')
    await symlink(join(f.root, 'outside'), join(f.cwd, 'link'))
    const after = await captureSource(f.cwd, put)
    assert.equal(after.files['ignored.txt'], undefined)
    assert.equal(after.files.link, undefined)
    assert.ok(after.omitted.some(x => x.path === 'link'))
    assert.equal([...contents.values()].includes('secret'), false)
    const diff = compareSources(before, after, hash => contents.get(hash)!)
    assert.deepEqual(diff.files.map(x => x.path), ['code.ts', 'line\nquote".sql'])
    const code = diff.files.find(x => x.path === 'code.ts')!
    assert.ok(diff.hunks[code.id]!.some(h => h.lines.includes('-  return 2') && h.lines.includes('+  return 3')))
    assert.ok(diff.targets.some(t => t.name === 'calculate' && t.kind === 'function'))
    assert.ok(diff.targets.some(t => t.kind === 'file' && diff.files.find(x => x.id === t.fileId)?.path.endsWith('.sql')))
  }
  finally {
    await rm(f.root, { recursive: true, force: true })
  }
})
it('persists fixed docs and diffs, isolates projects/revisions, and preserves human review across restarts', async () => {
  const f = await fixture()
  const dataDir = join(f.root, 'data')
  let reviews = await createReviews({ dataDir })
  try {
    await reviews.captureBefore('run-1', f.cwd, f.cwd)
    await writeFile(join(f.cwd, 'code.ts'), 'export function calculate() {\n  return 2\n}\n')
    await reviews.captureAfter('run-1', f.cwd, f.cwd, 'Example feature', true)
    const id = reviews.forRun(f.cwd, 'run-1').reviewId!
    const initial = reviews.read(f.cwd, id)
    assert.equal(initial.files.length, 1)
    assert.equal(initial.documents.filter(d => d.kind === 'requirement').length, 2)
    const doc = initial.documents.find(d => d.anchor === 'AC-CODE-UNKNOWN')!
    assert.equal(doc.stableAnchor, true)
    await writeFile(join(f.cwd, doc.path), '# Replaced\n')
    assert.match(reviews.document(f.cwd, id, initial.revision.id, doc.id).text, /Keep unknown/)
    const target = initial.targets.find(t => t.kind === 'function')!
    reviews.decide(f.cwd, id, initial.revision.id, { targetId: target.id, state: 'changes-requested', note: 'Keep zero distinct.' })
    assert.match(reviews.draft(f.cwd, id, initial.revision.id), /Keep zero distinct/)
    assert.throws(() => reviews.read(f.root, id), /不存在/)
    assert.throws(() => reviews.file(f.cwd, id, 'another-revision', initial.files[0]!.id), /不存在/)
    await reviews.captureBefore('run-2', f.cwd, f.cwd, undefined, id)
    await writeFile(join(f.cwd, 'code.ts'), 'export function calculate() {\n  return 0\n}\n')
    await reviews.captureAfter('run-2', f.cwd, f.cwd, 'Rework', true)
    const current = reviews.read(f.cwd, id)
    assert.equal(current.decisions.length, 0)
    assert.deepEqual(current.review.runIds, ['run-1', 'run-2'])
    assert.equal(current.revisions.length, 2)
    const file = reviews.file(f.cwd, id, current.revision.id, current.files.find(f => f.path === 'code.ts')!.id)
    assert.match(file.before!, /return 1/)
    assert.match(file.after!, /return 0/)
    assert.equal(reviews.read(f.cwd, id, initial.revision.id).decisions[0]!.state, 'changes-requested')
    reviews.setGeneration(f.cwd, id, current.revision.id, { state: 'running', runId: 'analysis' })
    const versionBeforeRestart = reviews.read(f.cwd, id).review.version
    reviews.close()
    reviews = await createReviews({ dataDir })
    assert.equal(reviews.read(f.cwd, id).generation.state, 'interrupted')
    assert.ok(reviews.read(f.cwd, id).review.version > versionBeforeRestart)
    assert.equal(reviews.read(f.cwd, id, initial.revision.id).decisions[0]!.note, 'Keep zero distinct.')
    reviews.remove(f.cwd, id)
    assert.throws(() => reviews.read(f.cwd, id), /不存在/)
  }
  finally {
    reviews.close()
    await rm(f.root, { recursive: true, force: true })
  }
})
it('reads pinned Git objects and preserves unavailable history rather than substituting current files', async () => {
  const f = await fixture()
  const reviews = await createReviews({ dataDir: join(f.root, 'data') })
  try {
    await writeFile(join(f.cwd, 'code.ts'), 'export const answer = 42\n')
    await f.git('add', '.')
    await f.git('commit', '-qm', 'target')
    await writeFile(join(f.cwd, 'code.ts'), 'THIS IS CURRENT, NOT COMMITTED')
    const review = await reviews.createComparison(f.cwd, 'HEAD~1', 'HEAD', 'Committed feature')
    const file = reviews.file(f.cwd, review.review.id, review.revision.id, review.files[0]!.id)
    assert.equal(file.after, 'export const answer = 42\n')
    assert.equal(reviews.forRun(f.cwd, 'old-run').reviewId, null)
    await reviews.captureBefore('interrupted', f.cwd, f.cwd)
    await reviews.captureAfter('interrupted', f.cwd, f.cwd, 'Unknown close', false)
    assert.equal(reviews.forRun(f.cwd, 'interrupted').reviewId, null)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(captureSource(f.cwd, () => {

    }, controller.signal))
    await assert.rejects(captureSource(f.root, () => {

    }))
    await assert.rejects(reviews.createComparison(f.cwd, '--help', 'HEAD', 'Invalid'))
  }
  finally {
    reviews.close()
    await rm(f.root, { recursive: true, force: true })
  }
})
it('refreshes source and documentation as a new review revision, and keeps shared hunks unassigned until every target is linked', async () => {
  const f = await fixture()
  const reviews = await createReviews({ dataDir: join(f.root, 'data') })
  try {
    await writeFile(join(f.cwd, 'code.ts'), 'export function first() { return 1 }\nexport function second() { return 2 }\n')
    await reviews.captureBefore('shared', f.cwd, f.cwd)
    await writeFile(join(f.cwd, 'code.ts'), 'export function first() { return 0 }\nexport function second() { return 0 }\n')
    await reviews.captureAfter('shared', f.cwd, f.cwd, 'Shared hunk', true)
    const id = reviews.forRun(f.cwd, 'shared').reviewId!
    const initial = reviews.read(f.cwd, id)
    const revision = initial.revision.id
    const route = { schemaVersion: 1 as const, revisionToken: reviews.context(f.cwd, id, revision).revisionToken, summary: 'Read functions', steps: [{ key: 'one', title: 'First', purpose: 'Preserve zero', requirementIds: [], designSectionIds: [], adrIds: [], evidenceIds: [], targets: [{ targetId: initial.targets[0]!.id, reason: 'changed', reviewFocus: 'zero' }] }], relations: [], gaps: [] }
    reviews.saveRoute(f.cwd, id, revision, route, 'agent', 'analysis', 'submit')
    const version = reviews.saveRoute(f.cwd, id, revision, route, 'agent', 'analysis', 'submit')
    assert.equal(version, 1)
    assert.ok(reviews.read(f.cwd, id).unassignedHunkIds.length)
    route.steps[0]!.targets.push({ targetId: initial.targets[1]!.id, reason: 'changed', reviewFocus: 'zero' })
    reviews.saveRoute(f.cwd, id, revision, route, 'user')
    assert.equal(reviews.read(f.cwd, id).unassignedHunkIds.length, 0)
    reviews.decide(f.cwd, id, revision, { targetId: initial.targets[0]!.id, state: 'seen', note: '' })
    assert.equal((await reviews.refreshSource(f.cwd, id)).revision.id, revision)
    await writeFile(join(f.cwd, 'docs/design/code.md'), '# DESIGN-CODE: New design\nChanged rationale.\n')
    const next = await reviews.refreshSource(f.cwd, id)
    assert.notEqual(next.revision.id, revision)
    assert.equal(next.decisions.length, 0)
    assert.equal(next.route, null)
    assert.equal(next.revisions.length, 2)
    assert.equal(reviews.read(f.cwd, id, revision).decisions[0]!.state, 'seen')
    reviews.remove(f.cwd, id)
    assert.match(reviews.forRun(f.cwd, 'shared').reason!, /用户已删除/)
  }
  finally {
    reviews.close()
    await rm(f.root, { recursive: true, force: true })
  }
})
it('never presents capture budget omissions as deleted files', async () => {
  const f = await fixture()
  const contents = new Map<string, string>()
  const put = (hash: string, text: string) => {
    contents.set(hash, text)
  }
  try {
    for (let i = 0; i < 505; i++) await writeFile(join(f.cwd, `file-${String(i).padStart(3, '0')}.txt`), 'same\n')
    const before = await captureSource(f.cwd, put)
    await writeFile(join(f.cwd, '000-new.txt'), 'new\n')
    const after = await captureSource(f.cwd, put)
    const result = compareSources(before, after, hash => contents.get(hash)!)
    assert.ok(result.files.some(file => file.path === '000-new.txt' && file.status === 'added'))
    assert.ok(result.gaps.some(gap => gap.kind === 'comparison-unavailable'))
    assert.ok(!result.files.some(file => file.status === 'deleted'))
  }
  finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

it('keeps oversized symbol sets at file level and bounds document catalogs without parsing fenced headings', () => {
  const base = { id: 'before', root: '/repo', head: null, capturedAt: '', files: { 'huge.ts': 'old' }, omitted: [], complete: true }
  const after = { ...base, id: 'after', files: { 'huge.ts': 'new' } }
  const content = (value: number) => Array.from({ length: 510 }, (_, i) => `export function fn${i}() { return ${value} }`).join('\n')
  const result = compareSources(base, after, hash => content(hash === 'old' ? 1 : 0))
  assert.equal(result.targets.length, 1)
  assert.equal(result.targets[0]!.kind, 'file')
  assert.ok(result.gaps.some(g => g.kind === 'symbol-budget'))
  const snapshot = { ...base, files: { 'docs/requirements/example.md': 'doc' } }
  const docs = sourceDocuments(snapshot, () => '# REQ-DUP: One\n~~~\n# FAKE\n```\n# FAKE2\n~~~\n# REQ-DUP: Two\n')
  assert.equal(docs.length, 2)
  assert.ok(docs.every(d => !d.stableAnchor))
  let limited = false
  const bounded = sourceDocuments(snapshot, () => Array.from({ length: 2001 }, (_, i) => `# REQ-${i}: Example`).join('\n'), () => {
    limited = true
  })
  assert.equal(bounded.length, 2000)
  assert.equal(limited, true)
})
