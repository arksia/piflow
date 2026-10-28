import type { FlowStore } from '../../flow/store'
import type { ServerConfig } from '../../server/config'
import type { SessionStore } from '../../sessions/index'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { API_FLOW_ACCEPT_PATH, API_FLOW_PATH, InvalidAgentConfiguration } from '@piflow/protocol'
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

it('returns actionable validation errors when an Agent configuration cannot be saved', async () => {
  const app = Fastify({ logger: false })
  await app.register(flowRoutes, {
    config: { rootCwd: '/project' } as ServerConfig,
    flow: {
      read: async () => ({ projectPath: '/project' }),
      replaceTopology: async () => { throw new InvalidAgentConfiguration('编排者不能成为成员') },
    } as unknown as FlowStore,
    sessions: { listSessions: async () => [] } as unknown as SessionStore,
  })
  try {
    const result = await app.inject({
      method: 'PUT',
      url: API_FLOW_PATH,
      payload: { projectPath: '/project', topology: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, commitGraph: true },
    })
    assert.equal(result.statusCode, 400)
    assert.equal(result.json().error, '编排者不能成为成员')
  }
  finally {
    await app.close()
  }
})
