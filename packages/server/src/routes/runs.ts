import type { FastifyPluginAsync } from 'fastify'
import type { SubagentRuns } from '../runs'
import { API_RUNS_PATH } from '@piflow/protocol'
import { RunError } from '../runs'
import { payload, query, send } from '../server/reply'

export const runRoutes: FastifyPluginAsync<{ runs: SubagentRuns }> = async (app, { runs }) => {
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof RunError ? error.statusCode : 500
    return send(reply, status, { error: error instanceof Error ? error.message : String(error) })
  })
  function project(request: Parameters<typeof query>[0]) {
    const value = query(request).projectPath
    if (typeof value !== 'string' || !value || value.length > 4000)
      throw new RunError('projectPath required')
    return value
  }
  function optional(value: unknown): string | undefined {
    if (value === undefined)
      return undefined
    if (typeof value !== 'string' || !value || value.length > 4000)
      throw new RunError('查询参数无效')
    return value
  }
  function integer(value: unknown): number | undefined {
    if (value === undefined)
      return undefined
    if (typeof value !== 'string' || !/^\d{1,16}$/.test(value) || !Number.isSafeInteger(Number(value)))
      throw new RunError('输出游标无效')
    return Number(value)
  }
  app.get(API_RUNS_PATH, async (request) => {
    const q = query(request)
    return runs.list({ projectPath: project(request), orchestratorId: optional(q.orchestratorId), roleId: optional(q.roleId), cursor: optional(q.cursor) })
  })
  app.get(`${API_RUNS_PATH}/:id`, request => runs.read(project(request), (request.params as { id: string }).id))
  app.get(`${API_RUNS_PATH}/:id/delivery`, request => runs.delivery(project(request), (request.params as { id: string }).id))
  app.get(`${API_RUNS_PATH}/:id/tools`, request => runs.tools({ projectPath: project(request), runId: (request.params as { id: string }).id, cursor: optional(query(request).cursor) }))
  app.get(`${API_RUNS_PATH}/:id/commands`, request => runs.commands({ projectPath: project(request), runId: (request.params as { id: string }).id, cursor: optional(query(request).cursor) }))
  app.get(`${API_RUNS_PATH}/:id/tools/:toolCallId`, (request) => {
    const { id, toolCallId } = request.params as { id: string, toolCallId: string }
    return runs.tool(project(request), id, toolCallId)
  })
  app.get(`${API_RUNS_PATH}/:id/output`, request => runs.output({ projectPath: project(request), runId: (request.params as { id: string }).id, version: integer(query(request).version), after: integer(query(request).after) }))
  app.post(`${API_RUNS_PATH}/:id/cancel`, async (request, reply) => {
    const body = payload<{ projectPath?: unknown }>(request)
    if (typeof body.projectPath !== 'string')
      throw new RunError('projectPath required')
    await runs.cancel(body.projectPath, (request.params as { id: string }).id)
    return send(reply, 202, { ok: true })
  })
}
