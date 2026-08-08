import type {
  ApiOkResponse,
  DirectoriesResponse,
  FlowDocumentResponse,
  HelloResponse,
  ModelsResponse,
  NewSessionRequest,
  OpenSessionRequest,
  PromptRequest,
  ReplaceFlowRequest,
  SessionsResponse,
  SessionStateResponse,
  SetModelRequest,
  SetThinkingRequest,
  UsageReport,
  UsageWindow,
} from '@piflow/protocol'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FlowStore } from '../flow/store'
import type { ServerConfig } from './config'
import type { StaticHandler } from './http'
import type { ManagedSession, SessionStore } from './sessions'
import type { SseHub } from './sse'
import {
  API_DIRECTORIES_PATH,
  API_EVENTS_PATH,
  API_FLOW_PATH,
  API_HELLO_PATH,
  API_MODELS_PATH,
  API_SESSIONS_NEW_PATH,
  API_SESSIONS_OPEN_PATH,
  API_SESSIONS_PATH,
  API_USAGE_PATH,
  AUTH_PATH,
  parseSessionActionPath,
} from '@piflow/protocol'
import { hasAuthCookie, isAllowedOrigin } from '../auth'
import { json, readBody } from './http'

interface UsageSnapshot {
  plan?: string
  windows: UsageWindow[]
}

interface CreateRequestHandlerOptions {
  config: ServerConfig
  sessions: SessionStore
  sse: SseHub
  serveStatic: StaticHandler
  getUsage: (provider: string, fresh?: boolean) => Promise<UsageSnapshot | null>
  flow: FlowStore
}

export function createRequestHandler(options: CreateRequestHandlerOptions) {
  const { config, sessions, sse, serveStatic, getUsage, flow } = options

  async function publishState(managed: ManagedSession) {
    sse.broadcast({ type: 'state', state: sessions.getState(managed) })
  }

  async function publishSessions() {
    sse.broadcast({ type: 'sessions', sessions: await sessions.listSessions() })
  }

  async function handlePrompt(managed: ManagedSession, text: string) {
    try {
      await managed.session.prompt(text, {
        streamingBehavior: managed.session.isStreaming ? 'steer' : undefined,
      })
    }
    catch (err) {
      sse.broadcast({ type: 'error', session: managed.key, error: String(err) })
    }
    await publishState(managed)
    await publishSessions()
  }

  async function handleApiRequest(req: IncomingMessage, res: ServerResponse, url: URL) {
    const path = url.pathname
    const method = req.method ?? 'GET'

    if (method === 'GET' && path === API_EVENTS_PATH) {
      sse.open(req, res)
      return
    }

    if (method === 'GET' && path === API_HELLO_PATH)
      return json(res, 200, { cwd: config.rootCwd } satisfies HelloResponse)

    if (method === 'GET' && path === API_SESSIONS_PATH)
      return json(res, 200, { sessions: await sessions.listSessions() } satisfies SessionsResponse)

    if (method === 'GET' && path === API_MODELS_PATH)
      return json(res, 200, { models: await sessions.getAvailableModels() } satisfies ModelsResponse)

    if (method === 'GET' && path === API_DIRECTORIES_PATH) {
      return json(res, 200, {
        listing: await sessions.listDirectories(url.searchParams.get('path') ?? config.rootCwd),
      } satisfies DirectoriesResponse)
    }

    if (method === 'GET' && path === API_FLOW_PATH) {
      const projectPath = url.searchParams.get('projectPath') ?? config.rootCwd
      return json(res, 200, { document: await flow.read(projectPath) } satisfies FlowDocumentResponse)
    }

    if (method === 'PUT' && path === API_FLOW_PATH) {
      const body = await readBody<ReplaceFlowRequest>(req)
      if (typeof body.projectPath !== 'string' || !body.topology)
        return json(res, 400, { error: 'projectPath and topology required' })
      const projectPath = (await flow.read(body.projectPath)).projectPath
      const knownSessions = await sessions.listSessions()
      const invalidNode = body.topology.nodes.find((node) => {
        const session = sessions.get(node.sessionPath) ?? knownSessions.find(session => session.path === node.sessionPath)
        return !session || session.cwd !== projectPath
      })
      if (invalidNode)
        return json(res, 400, { error: `session is not part of this project: ${invalidNode.sessionPath}` })
      const document = await flow.replaceTopology(projectPath, body.topology)
      return json(res, 200, { document } satisfies FlowDocumentResponse)
    }

    if (method === 'GET' && path === API_USAGE_PATH) {
      const key = url.searchParams.get('key')
      const managed = key ? sessions.get(key) : undefined
      const provider = managed?.session.model?.provider ?? url.searchParams.get('provider')
      if (!provider)
        return json(res, 200, { provider: null, supported: false, windows: [] } satisfies UsageReport)
      const fresh = url.searchParams.get('fresh') === '1'
      const report = await getUsage(provider, fresh)
      return json(res, 200, {
        provider,
        supported: !!report,
        plan: report?.plan,
        windows: report?.windows ?? [],
      } satisfies UsageReport)
    }

    if (method === 'POST' && path === API_SESSIONS_OPEN_PATH) {
      const body = await readBody<Partial<OpenSessionRequest>>(req)
      if (typeof body.path !== 'string')
        return json(res, 400, { error: 'path required' })
      const managed = await sessions.openSavedSession(body.path)
      if (!managed)
        return json(res, 404, { error: 'session not found' })
      return json(res, 200, { state: sessions.getState(managed) } satisfies SessionStateResponse)
    }

    if (method === 'POST' && path === API_SESSIONS_NEW_PATH) {
      const body = await readBody<NewSessionRequest>(req)
      const managed = await sessions.createFreshSession(body.cwd, body.persist === true)
      return json(res, 200, { state: sessions.getState(managed) } satisfies SessionStateResponse)
    }

    const action = parseSessionActionPath(path)
    if (method === 'POST' && action) {
      const managed = sessions.get(action.key)
      if (!managed)
        return json(res, 404, { error: `session not open: ${action.key}` })

      const body = await readBody(req)

      switch (action.action) {
        case 'prompt': {
          const prompt = body as Partial<PromptRequest>
          if (typeof prompt.text !== 'string' || !prompt.text.trim())
            return json(res, 400, { error: 'text required' })
          json(res, 202, { ok: true } satisfies ApiOkResponse)
          void handlePrompt(managed, prompt.text)
          return
        }

        case 'abort':
          await managed.session.abort()
          return json(res, 200, { ok: true } satisfies ApiOkResponse)

        case 'model': {
          const modelRequest = body as Partial<SetModelRequest>
          const model = sessions.findModel(String(modelRequest.provider), String(modelRequest.modelId))
          if (!model) {
            return json(res, 404, {
              error: `model not found: ${String(modelRequest.provider)}/${String(modelRequest.modelId)}`,
            })
          }
          await managed.session.setModel(model)
          await publishState(managed)
          return json(res, 200, { ok: true } satisfies ApiOkResponse)
        }

        case 'thinking': {
          const thinkingRequest = body as Partial<SetThinkingRequest>
          const level = managed.session
            .getAvailableThinkingLevels()
            .find(candidate => candidate === thinkingRequest.level)
          if (!level)
            return json(res, 400, { error: 'unknown thinking level' })
          managed.session.setThinkingLevel(level)
          await publishState(managed)
          return json(res, 200, { ok: true } satisfies ApiOkResponse)
        }
      }
    }

    json(res, 404, { error: 'not found' })
  }

  function hasTrustedOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin
    if (origin === undefined)
      return true
    return isAllowedOrigin(origin, req.headers.host)
  }

  function isAuthenticated(req: IncomingMessage): boolean {
    return hasAuthCookie(req.headers.cookie, config.authToken)
  }

  async function handleAuthRequest(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!hasTrustedOrigin(req)) {
      res.writeHead(403, { 'cache-control': 'no-store' }).end()
      return
    }
    const suppliedToken = url.searchParams.get('token')
    const authenticated = config.isLoopback
      || suppliedToken === config.authToken
      || isAuthenticated(req)
    if (!authenticated) {
      res.writeHead(401, { 'cache-control': 'no-store' }).end()
      return
    }
    res.writeHead(204, {
      'cache-control': 'no-store',
      'set-cookie': config.authHeader,
    }).end()
  }

  return (req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      const path = url.pathname

      if (path === AUTH_PATH) {
        await handleAuthRequest(req, res, url)
        return
      }

      if (path.startsWith('/api/')) {
        if (!hasTrustedOrigin(req)) {
          json(res, 403, { error: 'forbidden origin' })
          return
        }
        if (!isAuthenticated(req)) {
          json(res, 401, { error: 'unauthorized' })
          return
        }
        try {
          await handleApiRequest(req, res, url)
        }
        catch (err) {
          if (res.headersSent)
            res.end()
          else
            json(res, 500, { error: String(err) })
        }
        return
      }

      await serveStatic(res, path)
    })()
  }
}
