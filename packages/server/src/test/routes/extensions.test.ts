import type { ExtensionManager } from '../../extensions/manager'
import type { SessionStore } from '../../sessions/index'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { API_EXTENSIONS_PATH } from '@piflow/protocol'
import Fastify from 'fastify'
import { extensionRoutes } from '../../routes/extensions'

it('lists extensions for the requested directory', async () => {
  const app = Fastify({ logger: false })
  await app.register(extensionRoutes, {
    config: { rootCwd: 'D:/proj' },
    extensions: { list: () => [] } as unknown as ExtensionManager,
    sessions: {
      getProjectTrust: () => ({ trusted: false }),
      listDirectories: async (path: string) => ({ path }),
    } as unknown as SessionStore,
  })
  const response = await app.inject({ method: 'GET', url: `${API_EXTENSIONS_PATH}?cwd=D%3A%2Fproj` })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json().extensions, [])
  await app.close()
})
