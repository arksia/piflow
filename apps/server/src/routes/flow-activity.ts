import type { FlowActivityKind } from '@piflow/protocol'
import type { FastifyPluginAsync } from 'fastify'
import type { Reviews } from '../reviews/index.ts'
import type { SubagentRuns } from '../runs/index.ts'
import { realpath } from 'node:fs/promises'
import { API_FLOW_ACTIVITY_PATH } from '@piflow/protocol'
import { readFlowActivity } from '../flow/activity.ts'
import { RunError } from '../runs/index.ts'
import { query, send } from '../server/reply.ts'

export const flowActivityRoutes: FastifyPluginAsync<{ runs: Pick<SubagentRuns, 'activity'>, reviews?: Pick<Reviews, 'attention'> }> = async (app, { runs, reviews }) => {
  app.get(API_FLOW_ACTIVITY_PATH, async (request, reply) => {
    const value = query(request)
    try {
      if (typeof value.projectPath !== 'string' || !value.projectPath || value.projectPath.length > 4000 || ['orchestratorId', 'kind', 'cursor'].some(key => value[key] !== undefined && (typeof value[key] !== 'string' || !value[key])) || (value.orchestratorId?.length ?? 0) > 1000)
        throw new RunError('项目或组身份无效')
      let projectPath: string
      try {
        projectPath = await realpath(value.projectPath)
      }
      catch {
        throw new RunError('项目路径不存在', 404)
      }
      const result = await readFlowActivity({ projectPath, orchestratorId: value.orchestratorId, kind: value.kind as FlowActivityKind | undefined, cursor: value.cursor }, runs, reviews)
      return send(reply, 200, result)
    }
    catch (error) {
      if (error instanceof RunError)
        return send(reply, error.statusCode, { error: error.message })
      throw error
    }
  })
}
