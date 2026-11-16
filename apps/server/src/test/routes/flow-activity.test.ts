import type { RunSummary } from '@piflow/protocol'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import Fastify from 'fastify'
import { flowActivityRoutes } from '../../routes/flow-activity.ts'

it('canonicalizes activity scope and rejects malformed or cross-scope paging', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-activity-http-')))
  const project = join(root, 'project')
  await mkdir(project)
  await symlink(project, join(root, 'alias'))
  const app = Fastify()
  const calls: string[] = []
  try {
    await app.register(flowActivityRoutes, { runs: { activity: async (path) => {
      calls.push(path)
      return { activeRuns: [], sources: [], latestRuns: path === project ? Array.from({ length: 25 }, (_, i) => ({ id: `run-${i}`, projectPath: project, roleId: `role-${i}`, roleName: 'Coder', orchestratorId: 'owner', status: 'failed', taskPreview: 'task', createdAt: '2026-11-10T00:00:00Z' } as RunSummary)) : [] }
    } } })
    const scope = `projectPath=${encodeURIComponent(project)}`
    const path = '/api/flow/activity'
    assert.equal((await app.inject({ url: path })).statusCode, 400)
    assert.equal((await app.inject({ url: `${path}?${scope}&projectPath=x` })).statusCode, 400)
    assert.equal((await app.inject({ url: `${path}?${scope}&orchestratorId=x&orchestratorId=y` })).statusCode, 400)
    assert.equal((await app.inject({ url: `${path}?${scope}&kind=invalid` })).statusCode, 400)
    assert.equal((await app.inject({ url: `${path}?${scope}&cursor=bad` })).statusCode, 400)
    const response = await app.inject({ url: `${path}?projectPath=${encodeURIComponent(join(root, 'alias'))}` })
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['cache-control'], 'no-store')
    const page = response.json()
    assert.equal(page.projectPath, project)
    assert.equal(page.totals.latestFailures, 25)
    assert.equal(page.items.length, 20)
    assert.deepEqual(calls, [project])
    const cursor = encodeURIComponent(page.nextCursor)
    assert.equal((await app.inject({ url: `${path}?${scope}&cursor=${cursor}` })).json().items.length, 5)
    assert.equal((await app.inject({ url: `${path}?projectPath=${encodeURIComponent(root)}&cursor=${cursor}` })).statusCode, 400)
    assert.equal((await app.inject({ url: `${path}?${scope}&orchestratorId=other&cursor=${cursor}` })).statusCode, 400)
    assert.equal((await app.inject({ url: `${path}?${scope}&kind=latest-failure&cursor=${cursor}` })).statusCode, 400)
    const other = (await app.inject({ url: `${path}?projectPath=${encodeURIComponent(root)}` })).json()
    assert.equal(other.items.length, 0)
    assert.equal(other.totals.latestFailures, 0)
  }
  finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
