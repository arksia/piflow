import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { promisify } from 'node:util'
import { captureGitSnapshot } from '../../runs/git-snapshot'

const exec = promisify(execFile)
async function git(cwd: string, ...args: string[]) {
  return exec('git', ['-C', cwd, '-c', 'user.name=piflow-test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args])
}
it('captures dirty baselines, staged/unstaged changes, renames and exact unusual paths', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-git-')))
  try {
    await git(root, 'init', '-b', 'main')
    const unborn = await captureGitSnapshot(root)
    assert.equal(unborn.state, 'recorded')
    assert.equal(unborn.head, null)
    assert.equal(unborn.branch, 'main')
    await writeFile(join(root, 'a.txt'), 'initial\n')
    await writeFile(join(root, 'old name.txt'), 'rename me\n')
    await git(root, 'add', '.')
    await git(root, 'commit', '-m', 'initial')
    await writeFile(join(root, 'a.txt'), 'staged\n')
    await rename(join(root, 'old name.txt'), join(root, '新 name\nfile.txt'))
    await git(root, 'add', '-A')
    await writeFile(join(root, 'a.txt'), 'unstaged\n')
    await writeFile(join(root, '未跟踪\n文件.txt'), 'new')
    await mkdir(join(root, 'nested'))
    const snapshot = await captureGitSnapshot(join(root, 'nested'))
    assert.equal(snapshot.state, 'recorded')
    assert.equal(snapshot.root, root)
    assert.match(snapshot.head!, /^[a-f0-9]{40,64}$/)
    assert.deepEqual(snapshot.files.find(file => file.path === 'a.txt'), { path: 'a.txt', index: 'M', worktree: 'M' })
    assert.equal(snapshot.files.find(file => file.originalPath)?.path, '新 name\nfile.txt')
    assert.equal(snapshot.files.find(file => file.originalPath)?.originalPath, 'old name.txt')
    assert.equal(snapshot.files.find(file => file.path === '未跟踪\n文件.txt')?.worktree, '?')
    assert.match(snapshot.stagedStat, /a.txt/)
    assert.match(snapshot.unstagedStat, /a.txt/)
    await git(root, 'checkout', '--detach')
    const detached = await captureGitSnapshot(root)
    assert.equal(detached.state === 'recorded' ? detached.branch : 'unavailable', null)
    await Promise.all(Array.from({ length: 210 }, (_, i) => writeFile(join(root, `untracked-${i}`), 'data')))
    const large = await captureGitSnapshot(root)
    assert.equal(large.state === 'recorded' && large.files.length, 200)
    assert.equal(large.state === 'recorded' && large.filesTruncated, true)
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
it('keeps non-repositories, cancellations and time budgets distinct from clean Git states', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-git-unavailable-')))
  try {
    const missing = await captureGitSnapshot(root)
    assert.equal(missing.state, 'unavailable')
    assert.match(missing.state === 'unavailable' ? missing.reason! : '', /不在 Git 仓库/)
    const cancelled = await captureGitSnapshot(root, AbortSignal.abort())
    assert.equal(cancelled.state, 'unavailable')
    assert.match(cancelled.state === 'unavailable' ? cancelled.reason! : '', /取消/)
    const timedOut = await captureGitSnapshot(root, undefined, 0)
    assert.equal(timedOut.state, 'unavailable')
    assert.match(timedOut.state === 'unavailable' ? timedOut.reason! : '', /时间预算/)
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
