import assert from 'node:assert/strict'
import { it } from 'node:test'
import { parseGitBranches } from './git'

it('reads the current branch name and ignores the head marker', () => {
  assert.deepEqual(parseGitBranches('*main\n feature\n'), {
    current: 'main',
    branches: ['main', 'feature'],
  })
  assert.deepEqual(parseGitBranches(' main\n'), {
    current: null,
    branches: ['main'],
  })
  assert.deepEqual(parseGitBranches(''), { current: null, branches: [] })
})
