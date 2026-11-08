import type { ReviewDecision, ReviewRoute } from '@piflow/protocol'
import type { FastifyPluginAsync } from 'fastify'
import type { Reviews } from '../reviews'
import type { ReviewGeneration } from '../reviews/generation'
import type { SubagentRuns } from '../runs'
import { realpath } from 'node:fs/promises'
import { API_REVIEWS_PATH, API_RUNS_PATH } from '@piflow/protocol'
import { ReviewError } from '../reviews'
import { param, payload, query, send } from '../server/reply'

export const reviewRoutes: FastifyPluginAsync<{ reviews: Reviews, generation: ReviewGeneration, runs: SubagentRuns, isTrusted: (project: string) => boolean }> = async (app, { reviews, generation, runs, isTrusted }) => {
  app.setErrorHandler((error, _request, reply) => send(reply, error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500, { error: error instanceof Error ? error.message : String(error) }))
  function text(value: unknown, max = 200) {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
      throw new ReviewError('缺少有效的审查参数。')
    return value
  }
  async function project(value: unknown) {
    try {
      return await realpath(text(value, 4000))
    }
    catch (error) {
      if (error instanceof ReviewError)
        throw error
      throw new ReviewError('项目不存在。', 404)
    }
  }
  const root = `${API_REVIEWS_PATH}/:id`
  app.get(`${API_RUNS_PATH}/:id/review`, async (request) => {
    const p = await project(query(request).projectPath)
    await runs.read(p, param(request, 'id'))
    return reviews.forRun(p, param(request, 'id'))
  })
  app.get(root, async request => reviews.read(await project(query(request).projectPath), param(request, 'id'), query(request).revisionId))
  app.get(`${root}/files/:fileId`, async request => reviews.file(await project(query(request).projectPath), param(request, 'id'), text(query(request).revisionId), param(request, 'fileId')))
  app.get(`${root}/documents/:documentId`, async request => reviews.document(await project(query(request).projectPath), param(request, 'id'), text(query(request).revisionId), param(request, 'documentId')))
  app.get(`${root}/draft`, async request => ({ text: reviews.draft(await project(query(request).projectPath), param(request, 'id'), text(query(request).revisionId)) }))
  app.post(`${root}/decisions`, async (request) => {
    const b = payload<Record<string, unknown>>(request)
    return reviews.decide(await project(b.projectPath), param(request, 'id'), text(b.revisionId), { targetId: text(b.targetId), state: text(b.state) as ReviewDecision['state'], note: typeof b.note === 'string' ? b.note : '' })
  })
  app.post(`${root}/route`, async (request) => {
    const b = payload<Record<string, unknown>>(request)
    return { version: reviews.saveRoute(await project(b.projectPath), param(request, 'id'), text(b.revisionId), b.route as ReviewRoute, 'user') }
  })
  app.post(`${root}/generate`, async (request, reply) => {
    const b = payload<Record<string, unknown>>(request)
    const p = await project(b.projectPath)
    if (!isTrusted(p))
      throw new ReviewError('请先信任项目后再运行模型分析。', 403)
    generation.start(p, param(request, 'id'), text(b.revisionId))
    return send(reply, 202, { ok: true })
  })
  app.post(`${root}/cancel`, async (request, reply) => {
    const b = payload<Record<string, unknown>>(request)
    generation.cancel(await project(b.projectPath), param(request, 'id'), text(b.revisionId))
    return send(reply, 202, { ok: true })
  })
  app.post(API_REVIEWS_PATH, async (request) => {
    const b = payload<Record<string, unknown>>(request)
    return reviews.createComparison(await project(b.projectPath), text(b.base, 200), text(b.target, 200), text(b.title))
  })
  app.post(`${root}/remove`, async (request) => {
    const b = payload<Record<string, unknown>>(request)
    const p = await project(b.projectPath)
    if (reviews.read(p, param(request, 'id')).generation.state === 'running')
      throw new ReviewError('请先取消路线生成。', 409)
    reviews.remove(p, param(request, 'id'))
    return { ok: true }
  })
}
