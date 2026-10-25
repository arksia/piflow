import type {
  AcceptConductorRequest,
  FlowDocumentResponse,
  ReplaceFlowRequest,
} from '@piflow/protocol'
import type { FastifyPluginAsync } from 'fastify'
import type { FlowStore } from '../flow/store'
import type { ServerConfig } from '../server/config'
import type { SessionStore } from '../sessions/index'
import {
  API_FLOW_ACCEPT_PATH,
  API_FLOW_PATH,
  conductorDraftReady,
  UnsupportedProjectCanvasVersion,
} from '@piflow/protocol'
import { payload, searchParams, send } from '../server/reply'

interface RegisterFlowRoutesOptions {
  config: ServerConfig
  flow: FlowStore
  sessions: SessionStore
}

export const flowRoutes: FastifyPluginAsync<RegisterFlowRoutesOptions> = async (app, options) => {
  const { config, flow, sessions } = options

  app.get(API_FLOW_PATH, async (request, reply) => {
    const projectPath = searchParams(request).get('projectPath') ?? config.rootCwd
    try {
      const state = await flow.readState(projectPath)
      return send(reply, 200, { document: state.document, stored: state.stored } satisfies FlowDocumentResponse)
    }
    catch (error) {
      if (error instanceof UnsupportedProjectCanvasVersion)
        return send(reply, 409, { error: error.message })
      throw error
    }
  })

  app.put(API_FLOW_PATH, async (request, reply) => {
    const body = payload<ReplaceFlowRequest>(request)
    if (typeof body.projectPath !== 'string' || !body.topology)
      return send(reply, 400, { error: 'projectPath and topology required' })
    try {
      const projectPath = (await flow.read(body.projectPath)).projectPath
      const knownSessions = await sessions.listSessions()
      const invalidNode = body.topology.nodes.find((node) => {
        if (!node.sessionPath)
          return false
        const session = sessions.get(node.sessionPath) ?? knownSessions.find(session => session.path === node.sessionPath)
        return !session || session.cwd !== projectPath
      })
      if (invalidNode)
        return send(reply, 400, { error: `session is not part of this project: ${invalidNode.sessionPath}` })
      const document = await flow.replaceTopology(projectPath, body.topology, { commitGraph: body.commitGraph === true })
      return send(reply, 200, { document, stored: true } satisfies FlowDocumentResponse)
    }
    catch (error) {
      if (error instanceof UnsupportedProjectCanvasVersion)
        return send(reply, 409, { error: error.message })
      throw error
    }
  })

  app.post(API_FLOW_ACCEPT_PATH, {
    preHandler: async (request, reply) => {
      const body = payload<Partial<AcceptConductorRequest>>(request)
      if (typeof body.projectPath !== 'string' || !conductorDraftReady(body.draft))
        return send(reply, 400, { error: 'invalid conductor draft' })
    },
  }, async (request, reply) => {
    const body = payload<AcceptConductorRequest>(request)
    try {
      const document = await flow.acceptConductor(body.projectPath, body.draft)
      return send(reply, 200, { document, stored: true } satisfies FlowDocumentResponse)
    }
    catch (error) {
      if (error instanceof UnsupportedProjectCanvasVersion)
        return send(reply, 409, { error: error.message })
      if (error instanceof Error && error.message === 'invalid conductor draft')
        return send(reply, 400, { error: error.message })
      throw error
    }
  })
}
