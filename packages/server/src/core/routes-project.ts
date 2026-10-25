import type {
  ApiOkResponse,
  ComposerCommandsResponse,
  ComposerPathsResponse,
  DirectoriesResponse,
  ExtensionChangeResponse,
  ExtensionsResponse,
  ExtensionUIResponseBody,
  GitBranchesResponse,
  GitCheckoutRequest,
  InstallExtensionRequest,
  ProjectTrustResponse,
  RemoveExtensionRequest,
  TrustProjectRequest,
} from '@piflow/protocol'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ExtensionManager } from '../extensions/manager'
import type { ServerConfig } from './config'
import type { SessionStore } from './sessions'
import {
  API_COMPOSER_PATH,
  API_DIRECTORIES_PATH,
  API_EXTENSIONS_PATH,
  API_EXTENSIONS_UI_RESPONSE_PATH,
  API_GIT_PATH,
  API_PROJECT_TRUST_PATH,
} from '@piflow/protocol'
import { composerCommandsFromSession } from './composer-commands'
import { completePaths } from './composer-paths'
import { checkoutGitBranch, readGitBranches } from './git'
import { payload, searchParams, send } from './http-reply'
import { SessionsStreamingError } from './sessions'

interface RegisterProjectRoutesOptions {
  config: ServerConfig
  extensions: ExtensionManager
  sessions: SessionStore
}

export function registerProjectRoutes(app: FastifyInstance, options: RegisterProjectRoutesOptions): void {
  const { config, extensions, sessions } = options

  async function reloadAfterExtensionChange(reply: FastifyReply, cwd?: string) {
    const reloaded = await sessions.reloadExtensions(cwd)
    return send(reply, 200, { ok: true, reloaded } satisfies ExtensionChangeResponse)
  }

  app.get(API_COMPOSER_PATH, async (request, reply) => {
    const query = searchParams(request)
    const kind = query.get('kind')
    if (kind === 'paths') {
      const cwd = query.get('cwd')
      if (!cwd)
        return send(reply, 400, { error: 'cwd required' })
      try {
        const paths = await completePaths(cwd, query.get('q') ?? '')
        return send(reply, 200, { paths: paths.map(path => ({ path })) } satisfies ComposerPathsResponse)
      }
      catch (error) {
        const message = error instanceof Error && error.message ? error.message : 'path lookup failed'
        return send(reply, 400, { error: message })
      }
    }
    if (kind === 'commands') {
      const session = query.get('session')
      if (!session)
        return send(reply, 400, { error: 'session required' })
      const managed = sessions.get(session)
      if (!managed)
        return send(reply, 404, { error: `session not found: ${session}` })
      return send(reply, 200, { commands: composerCommandsFromSession(managed) } satisfies ComposerCommandsResponse)
    }
    return send(reply, 400, { error: 'kind must be paths or commands' })
  })

  app.get(API_DIRECTORIES_PATH, async (request, reply) => {
    return send(reply, 200, {
      listing: await sessions.listDirectories(searchParams(request).get('path') ?? config.rootCwd),
    } satisfies DirectoriesResponse)
  })

  app.get(API_PROJECT_TRUST_PATH, async (request, reply) => {
    const cwd = (await sessions.listDirectories(searchParams(request).get('cwd') ?? config.rootCwd)).path
    return send(reply, 200, { status: sessions.getProjectTrust(cwd) } satisfies ProjectTrustResponse)
  })

  app.post(API_PROJECT_TRUST_PATH, async (request, reply) => {
    const body = payload<Partial<TrustProjectRequest>>(request)
    if (typeof body.cwd !== 'string')
      return send(reply, 400, { error: 'cwd required' })
    const cwd = (await sessions.listDirectories(body.cwd)).path
    return send(reply, 200, { status: await sessions.trustProject(cwd) } satisfies ProjectTrustResponse)
  })

  app.get(API_GIT_PATH, async (request, reply) => {
    const cwd = (await sessions.listDirectories(searchParams(request).get('cwd') ?? config.rootCwd)).path
    return send(reply, 200, await readGitBranches(cwd) satisfies GitBranchesResponse)
  })

  app.post(API_GIT_PATH, async (request, reply) => {
    const body = payload<Partial<GitCheckoutRequest>>(request)
    if (typeof body.cwd !== 'string' || typeof body.branch !== 'string' || !body.branch)
      return send(reply, 400, { error: 'cwd and branch required' })
    const cwd = (await sessions.listDirectories(body.cwd)).path
    try {
      sessions.assertIdle(cwd)
      return send(reply, 200, await checkoutGitBranch(cwd, body.branch) satisfies GitBranchesResponse)
    }
    catch (err) {
      if (err instanceof SessionsStreamingError)
        throw err
      return send(reply, 400, { error: err instanceof Error ? err.message : 'git failed' })
    }
  })

  app.get(API_EXTENSIONS_PATH, async (request, reply) => {
    const cwd = (await sessions.listDirectories(searchParams(request).get('cwd') ?? config.rootCwd)).path
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
