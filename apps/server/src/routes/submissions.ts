import type { SubmissionFactResponse } from '@piflow/protocol'
import type { FastifyPluginAsync } from 'fastify'
import type { SessionStore } from '../sessions/index.ts'
import { realpath } from 'node:fs/promises'
import { API_SUBMISSIONS_PATH } from '@piflow/protocol'
import { param, query, send } from '../server/reply.ts'

export const submissionRoutes: FastifyPluginAsync<{ sessions: SessionStore }> = async (app, { sessions }) => {
  app.get(`${API_SUBMISSIONS_PATH}/:id`, async (request, reply) => {
    const projectPath = query(request).projectPath
    if (!projectPath || projectPath.length > 4000)
      return send(reply, 400, { error: 'projectPath required' })
    let canonicalPath: string
    try {
      canonicalPath = await realpath(projectPath)
    }
    catch {
      return send(reply, 404, { error: 'project not found' })
    }
    const submission = sessions.readSubmission(canonicalPath, param(request, 'id'))
    if (!submission)
      return send(reply, 404, { error: 'submission not found' })
    return send(reply, 200, { submission } satisfies SubmissionFactResponse)
  })
}
