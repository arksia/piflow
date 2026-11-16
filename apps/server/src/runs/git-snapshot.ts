import type { GitWorkspaceSnapshot } from '@piflow/protocol'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import process from 'node:process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
function limited(text: string) {
  const bytes = Buffer.from(text)
  let end = Math.min(bytes.length, 16384)
  while (end < bytes.length && (bytes[end]! & 0xC0) === 0x80) end--
  return { text: bytes.subarray(0, end).toString('utf8'), truncated: bytes.length > end }
}
function parseStatus(text: string) {
  const records = text.split('\0')
  const files: Extract<GitWorkspaceSnapshot, { state: 'recorded' }>['files'] = []
  let head: string | null = null
  let branch: string | null = null
  let headKnown = false
  let branchKnown = false
  let total = 0
  for (let i = 0; i < records.length; i++) {
    const row = records[i]!
    if (!row)
      continue
    if (row.startsWith('# branch.oid ')) {
      const value = row.slice(13)
      head = value === '(initial)' ? null : value
      headKnown = true
    }
    else if (row.startsWith('# branch.head ')) {
      const value = row.slice(14)
      branch = value === '(detached)' ? null : value
      branchKnown = true
    }
    else if (row.startsWith('#')) {
      continue
    }
    else {
      let file: (typeof files)[number]
      if (row.startsWith('? ')) {
        file = { path: row.slice(2), index: '?', worktree: '?' }
      }
      else {
        const count = row[0] === '1' ? 6 : row[0] === '2' ? 7 : row[0] === 'u' ? 8 : null
        const match = count === null ? null : new RegExp(`^[12u] (..) (?:[^ ]+ ){${count}}([\\s\\S]+)$`).exec(row)
        if (!match)
          throw new Error('无法解析 Git 文件状态。')
        file = { path: match[2]!, index: match[1]![0]!, worktree: match[1]![1]! }
        if (row[0] === '2') {
          file.originalPath = records[++i]
          if (!file.originalPath)
            throw new Error('Git 重命名记录不完整。')
        }
      }
      total++
      if (files.length < 200)
        files.push(file)
    }
  }
  if (!headKnown || !branchKnown)
    throw new Error('Git 快照缺少仓库身份。')
  return { head, branch, files, filesTruncated: total > files.length }
}
/** Read-only observations, not an atomic snapshot or attribution of changes. */
export async function captureGitSnapshot(cwd: string, signal?: AbortSignal, budgetMs = 5000): Promise<GitWorkspaceSnapshot> {
  const startedAt = new Date().toISOString()
  const timeout = AbortSignal.timeout(budgetMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const env = { ...process.env, LC_ALL: 'C' }
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_NAMESPACE'])
    delete (env as Record<string, string | undefined>)[key]
  async function git(args: string[]) {
    const { stdout } = await exec('git', ['--no-optional-locks', '-C', cwd, '-c', 'core.fsmonitor=false', ...args], { env, signal: combined, timeout: budgetMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, encoding: 'utf8' })
    return stdout
  }
  try {
    const path = await git(['rev-parse', '--show-toplevel'])
    const root = await realpath(path.endsWith('\n') ? path.slice(0, -1) : path)
    const results = await Promise.allSettled([
      git(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']),
      git(['diff', '--cached', '--no-ext-diff', '--no-textconv', '--stat=160']),
      git(['diff', '--no-ext-diff', '--no-textconv', '--stat=160']),
    ])
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected')
      throw failed.reason
    const [status, staged, unstaged] = results.map(result => (result as PromiseFulfilledResult<string>).value) as [string, string, string]
    const stagedStat = limited(staged)
    const unstagedStat = limited(unstaged)
    return { state: 'recorded', startedAt, capturedAt: new Date().toISOString(), root, ...parseStatus(status), stagedStat: stagedStat.text, unstagedStat: unstagedStat.text, stagedStatTruncated: stagedStat.truncated, unstagedStatTruncated: unstagedStat.truncated }
  }
  catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string }
    const reason = signal?.aborted
      ? '采集已取消。'
      : timeout.aborted
        ? 'Git 采集超过时间预算。'
        : failure.code === 'ENOENT'
          ? 'Git 不可用。'
          : failure.stderr?.includes('not a git repository')
            ? '当前工作目录不在 Git 仓库中。'
            : failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
              ? 'Git 输出超过采集上限。'
              : `Git 采集不可用：${failure.message?.slice(0, 300) ?? '未知错误'}`
    return { state: 'unavailable', reason }
  }
}
