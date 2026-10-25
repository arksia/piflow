import type {
  ComposerCommandsResponse,
  ComposerPathsResponse,
  DirectoriesResponse,
  GitBranchesResponse,
  GitCheckoutRequest,
  ProjectTrustResponse,
  TrustProjectRequest,
} from '@piflow/protocol'
import type { FastifyPluginAsync } from 'fastify'
import type { ServerConfig } from '../server/config'
import type { SessionStore } from '../sessions/index'
import {
  API_COMPOSER_PATH,
  API_DIRECTORIES_PATH,
  API_GIT_PATH,
  API_PROJECT_TRUST_PATH,
} from '@piflow/protocol'
import { composerCommandsFromSession } from '../project/composer-commands'
import { completePaths } from '../project/composer-paths'
import { checkoutGitBranch, readGitBranches } from '../project/git'
import { payload, query, send } from '../server/reply'
import { SessionsStreamingError } from '../sessions/index'

interface ProjectRouteOptions {
  config: ServerConfig
  sessions: SessionStore
}

export const projectRoutes: FastifyPluginAsync<ProjectRouteOptions> = async (app, options) => {
  const { config, sessions } = options

  app.get(API_COMPOSER_PATH, async (request, reply) => {
    const { cwd, kind, q, session } = query(request)
    if (kind === 'paths') {
      if (!cwd)
        return send(reply, 400, { error: 'cwd required' })
      try {
        const paths = await completePaths(cwd, q ?? '')
        return send(reply, 200, { paths: paths.map(path => ({ path })) } satisfies ComposerPathsResponse)
      }
      catch (error) {
        const message = error instanceof Error && error.message ? error.message : 'path lookup failed'
        return send(reply, 400, { error: message })
      }
    }
    if (kind === 'commands') {
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
      listing: await sessions.listDirectories(query(request).path ?? config.rootCwd),
    } satisfies DirectoriesResponse)
  })

  app.get(API_PROJECT_TRUST_PATH, async (request, reply) => {
    const cwd = (await sessions.listDirectories(query(request).cwd ?? config.rootCwd)).path
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
    const cwd = (await sessions.listDirectories(query(request).cwd ?? config.rootCwd)).path
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
}
