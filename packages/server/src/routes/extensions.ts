import type {
  ApiOkResponse,
  ExtensionChangeResponse,
  ExtensionsResponse,
  ExtensionUIResponseBody,
  InstallExtensionRequest,
  RemoveExtensionRequest,
} from '@piflow/protocol'
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import type { ExtensionManager } from '../extensions/manager'
import type { ServerConfig } from '../server/config'
import type { SessionStore } from '../sessions/index'
import {
  API_EXTENSIONS_PATH,
  API_EXTENSIONS_UI_RESPONSE_PATH,
} from '@piflow/protocol'
import { payload, query, send } from '../server/reply'

interface ExtensionRouteOptions {
  config: Pick<ServerConfig, 'rootCwd'>
  extensions: ExtensionManager
  sessions: SessionStore
}

export const extensionRoutes: FastifyPluginAsync<ExtensionRouteOptions> = async (app, options) => {
  const { config, extensions, sessions } = options

  async function reloadAfterExtensionChange(reply: FastifyReply, cwd?: string) {
    const reloaded = await sessions.reloadExtensions(cwd)
    return send(reply, 200, { ok: true, reloaded } satisfies ExtensionChangeResponse)
  }

  app.get(API_EXTENSIONS_PATH, async (request, reply) => {
    const cwd = (await sessions.listDirectories(query(request).cwd ?? config.rootCwd)).path
    const trust = sessions.getProjectTrust(cwd)
    return send(reply, 200, { extensions: extensions.list(cwd, trust.trusted) } satisfies ExtensionsResponse)
  })

  app.post(API_EXTENSIONS_PATH, async (request, reply) => {
    const body = payload<Partial<InstallExtensionRequest>>(request)
    if (typeof body.source !== 'string' || !body.source.trim() || typeof body.cwd !== 'string'
      || (body.scope !== 'global' && body.scope !== 'project')) {
      return send(reply, 400, { error: 'source, cwd, and scope required' })
    }
    const cwd = (await sessions.listDirectories(body.cwd)).path
    const trust = sessions.getProjectTrust(cwd)
    if (body.scope === 'project' && !trust.trusted)
      return send(reply, 403, { error: 'project must be trusted before changing project extensions' })
    const affectedCwd = body.scope === 'project' ? cwd : undefined
    sessions.assertIdle(affectedCwd)
    await extensions.install(cwd, body.source, body.scope, trust.trusted)
    return reloadAfterExtensionChange(reply, affectedCwd)
  })

  app.delete(API_EXTENSIONS_PATH, async (request, reply) => {
    const body = payload<Partial<RemoveExtensionRequest>>(request)
    if (typeof body.source !== 'string' || !body.source.trim() || typeof body.cwd !== 'string'
      || (body.scope !== 'global' && body.scope !== 'project')) {
      return send(reply, 400, { error: 'source, cwd, and scope required' })
    }
    const cwd = (await sessions.listDirectories(body.cwd)).path
    const trust = sessions.getProjectTrust(cwd)
    if (body.scope === 'project' && !trust.trusted)
      return send(reply, 403, { error: 'project must be trusted before changing project extensions' })
    const affectedCwd = body.scope === 'project' ? cwd : undefined
    sessions.assertIdle(affectedCwd)
    const removed = await extensions.remove(cwd, body.source, body.scope, trust.trusted)
    if (!removed)
      return send(reply, 404, { error: `extension not configured: ${body.source}` })
    return reloadAfterExtensionChange(reply, affectedCwd)
  })

  app.post(API_EXTENSIONS_UI_RESPONSE_PATH, async (request, reply) => {
    const body = payload<Partial<ExtensionUIResponseBody>>(request)
    if (typeof body.id !== 'string' || typeof body.session !== 'string' || body.type !== 'extension_ui_response')
      return send(reply, 400, { error: 'valid extension UI response required' })
    if (!sessions.respondExtensionUi(body as ExtensionUIResponseBody))
      return send(reply, 404, { error: `session not open: ${body.session}` })
    return send(reply, 200, { ok: true } satisfies ApiOkResponse)
  })
}
