import type { Dirent } from 'node:fs'
import { execFile } from 'node:child_process'
import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const LIMIT = 20
// ponytail: a non-git folder is walked until this many files; git ls-files is the real path
const SCAN = 8000

export async function completePaths(cwd: string, query: string): Promise<string[]> {
  if (rejected(query))
    return []
  const root = await realpath(resolve(cwd))
  const info = await stat(root)
  if (!info.isDirectory())
    throw new Error('path is not a directory')
  const ranked = rankPaths(withDirectories(await listFiles(root)), query, LIMIT * 2)
  return keepInside(root, ranked, LIMIT)
}

/** Rank relative forward-slash paths. Directories end with `/`. */
export function rankPaths(paths: readonly string[], query: string, limit = LIMIT): string[] {
  const raw = query.replaceAll('\\', '/')
  if (rejected(raw))
    return []
  let base = ''
  let fuzzy = raw
  const slash = raw.lastIndexOf('/')
  if (slash !== -1) {
    base = raw.slice(0, slash + 1)
    fuzzy = raw.slice(slash + 1)
    if (!paths.some(path => path.startsWith(base)))
      return []
  }
  const ranked = paths
    .filter(path => !base || (path.startsWith(base) && path !== base))
    .map((path) => {
      const rest = base ? path.slice(base.length) : path
      return { path, rest, score: fuzzy ? scorePath(rest, fuzzy, path.endsWith('/')) : 1 }
    })
    .filter(item => item.score > 0)
  ranked.sort((a, b) => {
    if (fuzzy && a.score !== b.score)
      return b.score - a.score
    const depth = depthOf(a.rest) - depthOf(b.rest)
    if (depth)
      return depth
    if (a.rest.length !== b.rest.length)
      return a.rest.length - b.rest.length
    return a.path.localeCompare(b.path)
  })
  return ranked.slice(0, limit).map(item => item.path)
}

function rejected(query: string) {
  const raw = query.replaceAll('\\', '/')
  return raw.startsWith('~') || raw.startsWith('/') || /^[a-z]:/i.test(raw) || raw.split('/').includes('..')
}

function withDirectories(files: readonly string[]) {
  const dirs = new Set<string>()
  const plain = new Set<string>()
  for (const file of files) {
    if (!file || file === '.git' || file.startsWith('.git/'))
      continue
    if (file.endsWith('/')) {
      dirs.add(file)
      continue
    }
    plain.add(file)
    const parts = file.split('/')
    for (let i = 1; i < parts.length; i++)
      dirs.add(`${parts.slice(0, i).join('/')}/`)
  }
  return [...plain, ...dirs]
}

function scorePath(path: string, query: string, directory: boolean) {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  const fileName = trimmed.split('/').pop() ?? trimmed
  const lowerName = fileName.toLowerCase()
  const lowerPath = trimmed.toLowerCase()
  const q = query.toLowerCase()
  let value = 0
  if (lowerName === q)
    value = 100
  else if (lowerName.startsWith(q))
    value = 80
  else if (lowerName.includes(q))
    value = 50
  else if (lowerPath.includes(q))
    value = 30
  if (directory && value > 0)
    value += 10
  return value
}

function depthOf(path: string) {
  return path.split('/').filter(Boolean).length
}

async function listFiles(root: string) {
  const fromGit = await gitFiles(root)
  if (fromGit !== null)
    return fromGit
  return walkFiles(root)
}

async function gitFiles(root: string): Promise<string[] | null> {
  try {
    const { stdout } = await promisify(execFile)('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'], {
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
    return stdout.split('\0').filter(Boolean).map(path => path.replaceAll('\\', '/'))
  }
  catch {
    return null
  }
}

async function walkFiles(root: string) {
  const files: string[] = []
  await walk(root, root, files, { left: SCAN })
  return files
}

async function walk(dir: string, root: string, files: string[], budget: { left: number }) {
  if (budget.left <= 0)
    return
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  }
  catch {
    return
  }
  for (const entry of entries) {
    if (budget.left <= 0)
      return
    if (entry.name === '.git')
      continue
    const abs = join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      // ponytail: list a symlink that stays inside, but do not walk it
      const rel = await linkPath(root, abs)
      if (rel)
        files.push(rel)
      continue
    }
    if (entry.isDirectory()) {
      await walk(abs, root, files, budget)
      continue
    }
    if (!entry.isFile())
      continue
    files.push(posixRelative(root, abs))
    budget.left -= 1
  }
}

async function linkPath(root: string, abs: string) {
  try {
    const real = await realpath(abs)
    if (!inside(root, real))
      return null
    const rel = posixRelative(root, abs)
    return (await stat(real)).isDirectory() ? `${rel}/` : rel
  }
  catch {
    return null
  }
}

async function keepInside(root: string, paths: readonly string[], limit: number) {
  const kept: string[] = []
  for (const path of paths) {
    const abs = join(root, ...path.split('/').filter(Boolean))
    try {
      const info = await lstat(abs)
      if (info.isSymbolicLink()) {
        const real = await realpath(abs)
        if (!inside(root, real))
          continue
      }
    }
    catch {
      continue
    }
    kept.push(path)
    if (kept.length === limit)
      break
  }
  return kept
}

function posixRelative(root: string, abs: string) {
  return relative(root, abs).replaceAll('\\', '/')
}

function inside(root: string, target: string) {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}
