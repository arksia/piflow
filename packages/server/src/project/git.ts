import type { GitBranchesResponse } from '@piflow/protocol'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

const gitOptions = { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 }

export function parseGitBranches(stdout: string): GitBranchesResponse {
  const branches: string[] = []
  let current: string | null = null
  for (const line of stdout.split(/\r?\n/)) {
    if (line.length < 2)
      continue
    const name = line.slice(1)
    branches.push(name)
    if (line.startsWith('*'))
      current = name
  }
  return { current, branches }
}

export async function readGitBranches(cwd: string): Promise<GitBranchesResponse> {
  try {
    const { stdout } = await execFile('git', ['branch', '--format=%(HEAD)%(refname:short)'], { cwd, ...gitOptions })
    return parseGitBranches(stdout)
  }
  catch (err) {
    if (isMissingRepo(err))
      return { current: null, branches: [] }
    throw gitFailure(err)
  }
}

export async function checkoutGitBranch(cwd: string, branch: string): Promise<GitBranchesResponse> {
  const listed = await readGitBranches(cwd)
  if (!listed.branches.includes(branch))
    throw new Error('unknown branch')
  try {
    await execFile('git', ['switch', '--', branch], { cwd, ...gitOptions })
  }
  catch (err) {
    throw gitFailure(err)
  }
  return readGitBranches(cwd)
}

function isMissingRepo(err: unknown): boolean {
  const text = failureText(err)
  return text.includes('not a git repository') || text.includes('not a git repo')
}

function gitFailure(err: unknown): Error {
  return new Error(failureText(err) || 'git failed')
}

function failureText(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = String((err as { stderr: unknown }).stderr).trim()
    if (stderr)
      return stderr
  }
  return err instanceof Error ? err.message : ''
}
