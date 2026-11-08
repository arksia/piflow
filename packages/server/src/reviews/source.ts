import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
export const digest = (text: string) => createHash('sha256').update(text).digest('hex')
export interface SourceSnapshot {
  id: string
  root: string
  capturedAt: string
  head: string | null
  files: Record<string, string>
  omitted: {
    path: string
    reason: string
  }[]
  complete: boolean
}
export class ReviewError extends Error {
  constructor(message: string, public statusCode = 400) { super(message) }
}
export function gitEnvironment() {
  const env = { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' }
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_') && key !== 'GIT_OPTIONAL_LOCKS')
      delete (env as Record<string, string | undefined>)[key]
  }
  return env
}
export async function git(cwd: string, args: string[], signal?: AbortSignal) {
  const result = await exec('git', ['--no-optional-locks', '-C', cwd, '-c', 'core.fsmonitor=false', ...args], { env: gitEnvironment(), signal, timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' })
  return result.stdout
}
function inside(root: string, path: string) {
  const rel = relative(root, path)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\')
}
/** Bounded text capture. No repository code, symlinks, git hooks or filters execute. */
export async function captureSource(cwd: string, put: (hash: string, text: string) => void, signal?: AbortSignal, commit?: string): Promise<SourceSnapshot> {
  const timeout = AbortSignal.timeout(15000)
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout
  const root = await realpath((await git(cwd, ['rev-parse', '--show-toplevel'], abort)).replace(/\n$/, ''))
  let pinned: string | null = null
  if (commit) {
    if (commit.length > 200 || commit.startsWith('-') || /[\0\r\n]/.test(commit))
      throw new ReviewError('提交引用无效')
    pinned = (await git(root, ['rev-parse', '--verify', '--end-of-options', `${commit}^{commit}`], abort)).trim()
  }
  else {
    try {
      pinned = (await git(root, ['rev-parse', '--verify', 'HEAD'], abort)).trim()
    }
    catch { /* An unborn repository can still have a working-tree comparison. */ }
  }
  const listing = commit
    ? await git(root, ['ls-tree', '-rz', '--full-tree', pinned!], abort)
    : await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], abort)
  const rows = [...new Set(listing.split('\0').filter(Boolean))].sort()
  const files: Record<string, string> = Object.create(null)
  const omitted: SourceSnapshot['omitted'] = []
  let total = 0
  for (let i = 0; i < rows.length; i++) {
    abort.throwIfAborted()
    const row = rows[i]!
    const match = commit ? /^(\d+) \w+ ([a-f\d]+)\t([\s\S]+)$/.exec(row) : null
    const path = match ? match[3]! : row
    if (i >= 500) {
      omitted.push({ path: '*', reason: `${rows.length - i} 个文件超过 500 文件预算。` })
      break
    }
    if (isAbsolute(path) || !inside(root, join(root, path)) || path.split(/[\\/]/).includes('.git')) {
      omitted.push({ path, reason: '文件路径不在可采集范围。' })
      continue
    }
    try {
      let data: Buffer
      if (commit) {
        if (!match || !['100644', '100755'].includes(match[1]!)) {
          omitted.push({ path, reason: '符号链接或子模块未采集。' })
          continue
        }
        const size = Number((await git(root, ['cat-file', '-s', match[2]!], abort)).trim())
        if (size > 1024 * 1024 || total + size > 20 * 1024 * 1024) {
          omitted.push({ path, reason: '文件或总正文超过采集预算。' })
          continue
        }
        const result = await exec('git', ['--no-optional-locks', '-C', root, 'cat-file', 'blob', match[2]!], { env: gitEnvironment(), signal: abort, timeout: 3000, maxBuffer: 1024 * 1024, encoding: 'buffer' })
        data = result.stdout
      }
      else {
        const absolute = join(root, path)
        let unsafe = false
        const segments = path.split('/')
        for (let j = 1; j <= segments.length; j++) {
          const info = await lstat(join(root, ...segments.slice(0, j)))
          if (info.isSymbolicLink()) {
            unsafe = true
            break
          }
        }
        if (unsafe || !inside(root, await realpath(absolute))) {
          omitted.push({ path, reason: '符号链接未采集。' })
          continue
        }
        const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          const before = await file.stat()
          if (!before.isFile() || before.size > 1024 * 1024 || total + before.size > 20 * 1024 * 1024) {
            omitted.push({ path, reason: '非普通文件或正文超过采集预算。' })
            continue
          }
          // Read at most the budget even when another process grows the file.
          const bytes = Buffer.alloc(before.size + 1)
          const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
          const after = await file.stat()
          if (bytesRead !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size) {
            omitted.push({ path, reason: '采集中发生变化，内容未固定。' })
            continue
          }
          data = bytes.subarray(0, bytesRead)
        }
        finally {
          await file.close()
        }
      }
      if (data.includes(0)) {
        omitted.push({ path, reason: '二进制内容未采集。' })
        continue
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
      total += data.length
      const hash = digest(text)
      put(hash, text)
      files[path] = hash
    }
    catch (error) {
      if (abort.aborted)
        throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        continue
      omitted.push({ path, reason: '文件不可读或不是 UTF-8 文本。' })
    }
  }
  if (!commit) {
    const after = await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], abort)
    if ([...new Set(after.split('\0').filter(Boolean))].sort().join('\0') !== rows.join('\0'))
      omitted.push({ path: '*', reason: '采集期间文件清单变化，快照可能不一致。' })
  }
  return { id: crypto.randomUUID(), root, head: pinned, capturedAt: new Date().toISOString(), files, omitted, complete: !omitted.length }
}
