import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { promisify } from 'node:util'
import { compareSources } from '../../reviews/analysis'
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
    reviews.close()
    reviews = await createReviews({ dataDir })
    assert.equal(reviews.read(f.cwd, id).generation.state, 'interrupted')
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
