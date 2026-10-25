import type {
  ApiOkResponse,
  CompactRequest,
  ForkPointsResponse,
  ForkSessionRequest,
  ModelsResponse,
  NavigateSessionRequest,
  NewSessionRequest,
  OpenSessionRequest,
  PromptRequest,
  RenameSessionRequest,
  SessionsResponse,
  SessionStateResponse,
  SessionTreeResponse,
  SetAutoCompactionRequest,
  SetModelRequest,
  SetThinkingRequest,
} from '@piflow/protocol'
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import type { SseHub } from '../server/sse'
import type { ManagedSession, SessionStore } from '../sessions/index'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  API_MODELS_PATH,
  API_SESSIONS_NEW_PATH,
  API_SESSIONS_OPEN_PATH,
  API_SESSIONS_PATH,
  MAX_PROMPT_IMAGE_BYTES,
  MAX_PROMPT_IMAGES,
} from '@piflow/protocol'
import { param, payload, searchParams, send } from '../server/reply'

interface RegisterSessionRoutesOptions {
  sessions: SessionStore
  sse: SseHub
}

const PROMPT_BODY_LIMIT = 140 * 1024 * 1024

export const sessionRoutes: FastifyPluginAsync<RegisterSessionRoutesOptions> = async (app, options) => {
  const { sessions, sse } = options
  const actionPath = (action: string) => `${API_SESSIONS_PATH}/:key/${action}`

  function requireOpen(reply: FastifyReply, key: string): ManagedSession | undefined {
    const managed = sessions.get(key)
    if (!managed)
      send(reply, 404, { error: `session not open: ${key}` })
    return managed
  }

  async function publishState(managed: ManagedSession) {
    sse.broadcast({ type: 'state', state: sessions.getState(managed) })
  }

  async function publishSessions() {
    sse.broadcast({ type: 'sessions', sessions: await sessions.listSessions() })
  }

  async function handlePrompt(managed: ManagedSession, prompt: PromptRequest) {
    try {
      await sessions.prompt(managed, prompt.text, prompt.images, prompt.streamingBehavior)
    }
    catch (err) {
      sessions.publishError(managed.key, String(err))
    }
    await publishState(managed)
    await publishSessions()
  }

  app.addHook('onClose', async () => {
    await sessions.disposeAll()
  })

  app.get(API_SESSIONS_PATH, async (_request, reply) => {
    return send(reply, 200, { sessions: await sessions.listSessions() } satisfies SessionsResponse)
  })

  app.get(API_MODELS_PATH, async (request, reply) => {
    const key = searchParams(request).get('key')
    const managed = key ? sessions.get(key) : undefined
    if (!managed)
      return send(reply, 404, { error: `session not open: ${String(key)}` })
    return send(reply, 200, { models: await sessions.getAvailableModels(managed) } satisfies ModelsResponse)
  })

  app.post(API_SESSIONS_OPEN_PATH, async (request, reply) => {
    const body = payload<Partial<OpenSessionRequest>>(request)
    if (typeof body.path !== 'string')
      return send(reply, 400, { error: 'path required' })
    const managed = await sessions.openSavedSession(body.path, { refresh: true })
    if (!managed)
      return send(reply, 404, { error: 'session not found' })
    return send(reply, 200, { state: sessions.getState(managed) } satisfies SessionStateResponse)
  })

  app.post(API_SESSIONS_NEW_PATH, async (request, reply) => {
    const body = payload<NewSessionRequest>(request)
    const managed = await sessions.createFreshSession(body.cwd, body.persist === true, body.conductor === true)
    if (body.conductor === true)
      await publishSessions()
    return send(reply, 200, { state: sessions.getState(managed) } satisfies SessionStateResponse)
  })

  app.post(actionPath('rename'), async (request, reply) => {
    const key = param(request, 'key')
    const body = payload<Partial<RenameSessionRequest>>(request)
    if (typeof body.name !== 'string')
      return send(reply, 400, { error: 'name required' })
    if (!await sessions.renameSession(key, body.name.trim()))
      return send(reply, 404, { error: `session not found: ${key}` })
    await publishSessions()
    return send(reply, 200, { ok: true } satisfies ApiOkResponse)
  })

  app.get(actionPath('fork'), async (request, reply) => {
    const key = param(request, 'key')
    const points = await sessions.listForkPoints(key)
    if (!points)
      return send(reply, 404, { error: `session not found: ${key}` })
    return send(reply, 200, { points } satisfies ForkPointsResponse)
  })

  app.post(actionPath('fork'), async (request, reply) => {
    const key = param(request, 'key')
    const body = payload<Partial<ForkSessionRequest>>(request)
    if (typeof body.entryId !== 'string' || !body.entryId)
      return send(reply, 400, { error: 'entryId required' })
    const managed = await sessions.forkSession(key, body.entryId)
    if (!managed)
      return send(reply, 404, { error: `session not found: ${key}` })
    await publishSessions()
    return send(reply, 200, { state: sessions.getState(managed) } satisfies SessionStateResponse)
  })

  app.get(actionPath('tree'), async (request, reply) => {
    const key = param(request, 'key')
    const tree = await sessions.getSessionTree(key)
    if (!tree)
      return send(reply, 404, { error: `session not found: ${key}` })
    return send(reply, 200, tree satisfies SessionTreeResponse)
  })

  app.get(actionPath('export'), async (request, reply) => {
    const key = param(request, 'key')
    const managed = sessions.get(key)
    const filePath = managed?.runtime.session.sessionFile
    if (!managed && !filePath) {
      const session = await sessions.openSavedSession(key)
      if (!session)
        return send(reply, 404, { error: `session not found: ${key}` })
    }
    const active = sessions.get(key)
    const inputPath = active?.runtime.session.sessionFile
    if (!inputPath)
      return send(reply, 400, { error: 'session is not persisted' })
    const directory = await mkdtemp(join(tmpdir(), 'piflow-export-'))
    const outputPath = join(directory, 'session.html')
    try {
      await active!.runtime.session.exportToHtml(outputPath)
      const html = await readFile(outputPath, 'utf8')
      const inline = searchParams(request).get('inline') === '1'
      return reply.code(200)
        .header('content-type', 'text/html; charset=utf-8')
        .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename="session.html"`)
        .header('cache-control', 'no-cache')
        .send(html)
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  app.post(actionPath('navigate'), async (request, reply) => {
    const key = param(request, 'key')
    const body = payload<Partial<NavigateSessionRequest>>(request)
    if (typeof body.targetId !== 'string' || !body.targetId)
      return send(reply, 400, { error: 'targetId required' })
    const managed = await sessions.navigateTree(key, body.targetId)
    if (!managed)
      return send(reply, 404, { error: `session not found: ${key}` })
    return send(reply, 200, { state: sessions.getState(managed) } satisfies SessionStateResponse)
  })

  app.post(actionPath('delete'), async (request, reply) => {
    const key = param(request, 'key')
    const result = await sessions.deleteSession(key)
    if (result === 'missing')
      return send(reply, 404, { error: `session not found: ${key}` })
    if (result === 'streaming')
      return send(reply, 409, { error: 'session is streaming' })
    await publishSessions()
    return send(reply, 200, { ok: true } satisfies ApiOkResponse)
  })

  app.post(actionPath('prompt'), { bodyLimit: PROMPT_BODY_LIMIT }, async (request, reply) => {
    const managed = requireOpen(reply, param(request, 'key'))
    if (!managed)
      return
    const prompt = payload<Partial<PromptRequest>>(request)
    if (typeof prompt.text !== 'string' || (!prompt.text.trim() && !prompt.images?.length))
      return send(reply, 400, { error: 'text or image required' })
    const imageError = validatePromptImages(prompt.images)
    if (imageError)
      return send(reply, 400, { error: imageError })
    if (prompt.streamingBehavior !== undefined && prompt.streamingBehavior !== 'steer' && prompt.streamingBehavior !== 'followUp')
      return send(reply, 400, { error: 'unknown streaming behavior' })
    send(reply, 202, { ok: true } satisfies ApiOkResponse)
    void handlePrompt(managed, prompt as PromptRequest)
  })

  app.post(actionPath('abort'), async (request, reply) => {
    const managed = requireOpen(reply, param(request, 'key'))
    if (!managed)
      return
    await managed.runtime.session.abort()
    managed.extensionUi.cancelPending()
    return send(reply, 200, { state: sessions.getState(managed) } satisfies SessionStateResponse)
  })

  app.post(actionPath('clear-queue'), async (request, reply) => {
    const managed = requireOpen(reply, param(request, 'key'))
    if (!managed)
      return
    managed.runtime.session.clearQueue()
    await publishState(managed)
    return send(reply, 200, { state: sessions.getState(managed) } satisfies SessionStateResponse)
  })

  app.post(actionPath('model'), async (request, reply) => {
    const managed = requireOpen(reply, param(request, 'key'))
    if (!managed)
      return
    const modelRequest = payload<Partial<SetModelRequest>>(request)
    const model = sessions.findModel(managed, String(modelRequest.provider), String(modelRequest.modelId))
    if (!model) {
      return send(reply, 404, {
        error: `model not found: ${String(modelRequest.provider)}/${String(modelRequest.modelId)}`,
      })
    }
    await managed.runtime.session.setModel(model)
    await publishState(managed)
    return send(reply, 200, { state: sessions.getState(managed) } satisfies SessionStateResponse)
  })

  app.post(actionPath('thinking'), async (request, reply) => {
    const managed = requireOpen(reply, param(request, 'key'))
    if (!managed)
      return
    const thinkingRequest = payload<Partial<SetThinkingRequest>>(request)
    const level = managed.runtime.session.getAvailableThinkingLevels().find(candidate => candidate === thinkingRequest.level)
    if (!level)
      return send(reply, 400, { error: 'unknown thinking level' })
    managed.runtime.session.setThinkingLevel(level)
    await publishState(managed)
    return send(reply, 200, { state: sessions.getState(managed) } satisfies SessionStateResponse)
  })

  app.post(actionPath('compact'), async (request, reply) => {
    const managed = requireOpen(reply, param(request, 'key'))
    if (!managed)
      return
    const compactRequest = payload<Partial<CompactRequest>>(request)
    if (compactRequest.instructions !== undefined && typeof compactRequest.instructions !== 'string')
      return send(reply, 400, { error: 'instructions must be a string' })
    if (!managed.runtime.session.isIdle || managed.runtime.session.isCompacting)
      return send(reply, 409, { error: 'session is busy' })
    send(reply, 202, { ok: true } satisfies ApiOkResponse)
    void sessions.compact(managed, compactRequest.instructions).catch(error => sessions.publishError(managed.key, String(error)))
  })

  app.post(actionPath('abort-compaction'), async (request, reply) => {
    const managed = requireOpen(reply, param(request, 'key'))
    if (!managed)
      return
    sessions.abortCompaction(managed)
    return send(reply, 200, { state: sessions.getState(managed) } satisfies SessionStateResponse)
  })

  app.post(actionPath('auto-compaction'), async (request, reply) => {
    const managed = requireOpen(reply, param(request, 'key'))
    if (!managed)
      return
    const autoCompaction = payload<Partial<SetAutoCompactionRequest>>(request)
    if (typeof autoCompaction.enabled !== 'boolean')
      return send(reply, 400, { error: 'enabled must be a boolean' })
    sessions.setAutoCompaction(managed, autoCompaction.enabled)
    return send(reply, 200, { state: sessions.getState(managed) } satisfies SessionStateResponse)
  })
}

export function validatePromptImages(images: unknown): string | null {
  if (images === undefined)
    return null
  if (!Array.isArray(images) || images.length > MAX_PROMPT_IMAGES)
    return `at most ${MAX_PROMPT_IMAGES} images are supported`
  for (const image of images) {
    if (!image || typeof image !== 'object')
      return 'invalid image content'
    const { type, data, mimeType } = image as Record<string, unknown>
    if (type !== 'image' || typeof data !== 'string' || typeof mimeType !== 'string' || !mimeType.startsWith('image/'))
      return 'invalid image content'
    const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
    if (data.length % 4 !== 0 || !/^[a-z0-9+/]*={0,2}$/i.test(data) || data.length / 4 * 3 - padding > MAX_PROMPT_IMAGE_BYTES)
      return `each image must be valid base64 data no larger than ${MAX_PROMPT_IMAGE_BYTES / 1024 / 1024} MB`
  }
  return null
}
