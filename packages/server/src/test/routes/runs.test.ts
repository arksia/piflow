import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import Fastify from 'fastify'
import { runRoutes } from '../../routes/runs'
import { createSubagentRuns } from '../../runs'

it('validates run HTTP reads, project scopes, cursors and cancellation conflicts', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'piflow-run-http-')))
  const runs = await createSubagentRuns({ dataDir: join(root, 'data'), execute: async () => ({ output: '', cancelled: false, closed: true }) })
  const app = Fastify()
  try {
    await app.register(runRoutes, { runs })
    const result = await runs.execute({ projectPath: root, orchestratorId: 'main', orchestratorName: 'Main', roleId: 'code', roleName: 'Code', parentSessionPath: '/parent', parentToolCallId: 'call', task: 'Check', configurationSnapshot: { cwd: root, roleName: 'Code', effectivePrompt: '', model: 'a/b', thinkingLevel: 'off', tools: [], memberRoleIds: [] } })
    const url = `/api/runs/${result.runId}`
    const scope = `projectPath=${encodeURIComponent(root)}`
    assert.equal((await app.inject({ url: '/api/runs' })).statusCode, 400)
    assert.equal((await app.inject({ url: `${url}?${scope}` })).json().status, 'succeeded')
    assert.equal((await app.inject({ url: `${url}?projectPath=${encodeURIComponent(await realpath(tmpdir()))}` })).statusCode, 404)
    assert.equal((await app.inject({ url: `${url}/output?${scope}&after=-1` })).statusCode, 400)
    assert.equal((await app.inject({ url: `${url}/tools?${scope}&cursor=bad` })).statusCode, 400)
    assert.equal((await app.inject({ url: `${url}/tools/missing?${scope}` })).statusCode, 404)
    assert.equal((await app.inject({ url: `${url}/commands?${scope}` })).json().counts.total, 0)
    assert.equal((await app.inject({ url: `${url}/delivery?${scope}` })).json().availability, 'not-requested')
    assert.equal((await app.inject({ url: `${url}/delivery?projectPath=${encodeURIComponent(await realpath(tmpdir()))}` })).statusCode, 404)
    assert.equal((await app.inject({ url: `${url}/commands?${scope}&cursor=bad` })).statusCode, 400)
    assert.equal((await app.inject({ url: `${url}/commands?projectPath=${encodeURIComponent(await realpath(tmpdir()))}` })).statusCode, 404)
    assert.equal((await app.inject({ method: 'POST', url: `${url}/cancel`, payload: { projectPath: root } })).statusCode, 409)
    assert.equal((await app.inject({ method: 'POST', url: `${url}/cancel`, payload: {} })).statusCode, 400)
  }
  finally {
    await app.close()
    await runs.close()
    await rm(root, { recursive: true, force: true })
  }
})
