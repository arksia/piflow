import type {
  ApiOkResponse,
  ExecutionPromptRequest,
  ExecutionSessionResponse,
  ExecutionSnapshotResponse,
  ExecutionTargetQuery,
  OpenExecutionSessionRequest,
  PromptAcceptedResponse,
} from '@piflow/protocol'
import type { FastifyPluginAsync } from 'fastify'
import type { ProjectRuntime } from '../runtime/index.ts'
import { realpath } from 'node:fs/promises'
import { API_EXECUTION_SESSIONS_PATH } from '@piflow/protocol'
import { RuntimeCommandError } from '../runtime/messages.ts'
import { WorkerLostError } from '../runtime/project-workers.ts'
import { send } from '../server/reply.ts'

const pathSchema = { type: 'string', minLength: 1, maxLength: 4000 }
const identitySchema = { type: 'string', minLength: 1, maxLength: 200 }
const targetSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['projectPath', 'generation'],
    properties: { projectPath: pathSchema, generation: identitySchema },
  },
  params: { type: 'object', required: ['id'], properties: { id: identitySchema } },
}

/** Session lifecycle over HTTP; callers never send a native file path to a live control. */
export const executionRoutes: FastifyPluginAsync<{ runtime: ProjectRuntime }> = async (app, { runtime }) => {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof RuntimeCommandError && error.code !== 'execution-failed') {
      const status = { 'stale-target': 409, 'session-not-open': 404, 'session-busy': 409, 'model-not-found': 404, 'project-mismatch': 404 }[error.code]
      return send(reply, status, { error: error.code, code: error.code })
    }
    if (error instanceof WorkerLostError)
      return send(reply, 503, { error: 'Project execution is unavailable; explicitly reopen the Session', code: 'worker-unavailable' })
    if (error && typeof error === 'object' && 'statusCode' in error
      && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      return send(reply, error.statusCode, { error: 'Invalid execution request' })
    }
    request.log.error({ err: error }, 'Execution request failed')
    // Worker diagnostics can contain tool output and provider details; keep them in local logs.
    return send(reply, 500, { error: 'Execution request failed' })
  })

  app.post<{ Body: OpenExecutionSessionRequest }>(API_EXECUTION_SESSIONS_PATH, {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['projectPath'],
        properties: {
          projectPath: pathSchema,
          sessionPath: pathSchema,
          model: {
            type: 'object',
            additionalProperties: false,
            required: ['provider', 'id'],
            properties: { provider: identitySchema, id: identitySchema },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { projectPath, ...config } = request.body
    const session = await runtime.open(projectPath, config)
    return send(reply, 200, { session } satisfies ExecutionSessionResponse)
  })

  interface Target { Params: { id: string }, Querystring: ExecutionTargetQuery }
  async function resolveTarget(id: string, query: ExecutionTargetQuery) {
    let canonical: string
    try {
      canonical = await realpath(query.projectPath)
    }
    catch { throw new RuntimeCommandError('session-not-open', 'Session is not open') }
    return runtime.target(canonical, id, query.generation)
  }
  const targetPath = `${API_EXECUTION_SESSIONS_PATH}/:id`
  app.get<Target>(targetPath, { schema: targetSchema }, async (request, reply) => {
    const session = await resolveTarget(request.params.id, request.query)
    const snapshot = await runtime.snapshot(session)
    return send(reply, 200, { session, ...snapshot } satisfies ExecutionSnapshotResponse)
  })

  app.post<Target & { Body: ExecutionPromptRequest }>(`${targetPath}/prompt`, {
    schema: {
      ...targetSchema,
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          text: { type: 'string', minLength: 1, pattern: '\\S' },
          streamingBehavior: { type: 'string', enum: ['steer', 'followUp'] },
        },
      },
    },
  }, async (request, reply) => {
    const session = await resolveTarget(request.params.id, request.query)
    const { text, streamingBehavior } = request.body
    const submission = runtime.submit(session, text, streamingBehavior)
    void submission.completion.catch(error => request.log.error({ err: error, submissionId: submission.submissionId }, 'Submission did not complete'))
    return send(reply, 202, { ok: true, submissionId: submission.submissionId } satisfies PromptAcceptedResponse)
  })

  app.post<Target>(`${targetPath}/abort`, { schema: targetSchema }, async (request, reply) => {
    const session = await resolveTarget(request.params.id, request.query)
    await runtime.abort(session)
    return send(reply, 200, { ok: true } satisfies ApiOkResponse)
  })
  app.delete<Target>(targetPath, { schema: targetSchema }, async (request, reply) => {
    const session = await resolveTarget(request.params.id, request.query)
    await runtime.closeSession(session)
    return send(reply, 200, { ok: true } satisfies ApiOkResponse)
  })
}
