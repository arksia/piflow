import type { ServerConfig } from '../../server/config.ts'
import type { SessionStore } from '../../sessions/index.ts'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { API_COMPOSER_PATH } from '@piflow/protocol'
import Fastify from 'fastify'
import { projectRoutes } from '../../routes/project.ts'

it('rejects a composer lookup that does not say which kind it wants', async () => {
  const app = Fastify({ logger: false })
  await app.register(projectRoutes, {
    config: { rootCwd: 'D:/proj' } as ServerConfig,
    sessions: {} as SessionStore,
  })
  const response = await app.inject({ method: 'GET', url: API_COMPOSER_PATH })
  assert.equal(response.statusCode, 400)
  assert.equal(response.json().error, 'kind must be paths or commands')
  await app.close()
})
