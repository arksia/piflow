import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { completePaths, rankPaths } from './composer-paths'

it('ranks a fuzzy filename and caps the list', () => {
  const paths = ['src/App.tsx', 'src/', 'readme.md', ...Array.from({ length: 30 }, (_, i) => `other/file-${i}.txt`)]
  const ranked = rankPaths(paths, 'app')
  assert.equal(ranked[0], 'src/App.tsx')
  assert.equal(ranked.length, 1)
  assert.equal(rankPaths(paths, '').length, 20)
  assert.deepEqual(rankPaths(paths, '../secret'), [])
})

it('scopes a directory prefix and skips the directory itself', () => {
  assert.deepEqual(rankPaths(['src/', 'src/App.tsx', 'src/main.ts', 'other.txt'], 'src/'), [
    'src/App.tsx',
    'src/main.ts',
  ])
})

it('skips gitignored files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-paths-'))
  try {
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' })
    await writeFile(join(root, '.gitignore'), 'secret.txt\n')
    await writeFile(join(root, 'secret.txt'), 'nope')
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'App.tsx'), 'export {}\n')
    const hits = await completePaths(root, 'app')
    assert.ok(hits.includes('src/App.tsx'))
    assert.equal(hits.some(path => path.includes('secret')), false)
    assert.ok((await completePaths(root, '')).includes('src/'))
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('omits a symlink that leaves the working directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-paths-'))
  const outside = await mkdtemp(join(tmpdir(), 'piflow-outside-'))
  try {
    await writeFile(join(outside, 'note.txt'), 'out')
    try {
      await symlink(outside, join(root, 'escape'), 'dir')
    }
    catch {
      return
    }
    const hits = await completePaths(root, '')
    assert.equal(hits.some(path => path.startsWith('escape')), false)
  }
  finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
