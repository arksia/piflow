import type { FlowStore } from '../../flow/store'
import type { ServerConfig } from '../../server/config'
import type { SessionStore } from '../../sessions/index'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { API_FLOW_ACCEPT_PATH, API_FLOW_PATH } from '@piflow/protocol'
import Fastify from 'fastify'
import { flowRoutes } from '../../routes/flow'

it('reads a canvas and refuses an unfinished conductor draft', async () => {
  let accepted = false
  const app = Fastify({ logger: false })
  await app.register(flowRoutes, {
    config: { rootCwd: 'D:/proj' } as ServerConfig,
    flow: {
      acceptConductor: async () => {
        accepted = true
      },
      readState: async () => ({ document: { name: 'canvas' }, stored: false }),
    } as unknown as FlowStore,
    sessions: {} as SessionStore,
  })
  const loaded = await app.inject({ method: 'GET', url: API_FLOW_PATH })
  assert.equal(loaded.statusCode, 200)
  assert.equal(loaded.json().stored, false)
  const rejected = await app.inject({
    method: 'POST',
    payload: { projectPath: 'D:/proj' },
    url: API_FLOW_ACCEPT_PATH,
  })
  assert.equal(rejected.statusCode, 400)
  assert.equal(rejected.json().error, 'invalid conductor draft')
  assert.equal(accepted, false)
  await app.close()
})
