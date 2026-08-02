import type {
  AgentEvent,
  ChatMessage,
  DirectoriesResponse,
  DirectoryListing,
  HelloResponse,
  ModelInfo,
  ModelsResponse,
  ServerMessage,
  SessionContext,
  SessionInfoLite,
  SessionsResponse,
  SessionState,
  SessionStateResponse,
  UsageReport,
} from '@piflow/protocol'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import {
  AUTH_COOKIE,
  hasAuthCookie,
  isAllowedOrigin,
  isLoopbackHost,
  isValidAccessToken,
} from './protocol.js'
import { getUsage } from './usage/index.js'

const PORT = Number(process.env.PORT ?? 3141)
const HOST = process.env.HOST ?? '127.0.0.1'
const ROOT_CWD = resolve(process.env.INIT_CWD ?? process.cwd())
const IS_LOOPBACK = isLoopbackHost(HOST)
const configuredToken = process.env.PIFLOW_TOKEN
if (!IS_LOOPBACK && !configuredToken)
  throw new Error('PIFLOW_TOKEN is required when HOST is not a loopback address')
if (configuredToken && !isValidAccessToken(configuredToken))
  throw new Error('PIFLOW_TOKEN must contain at least 24 URL-safe characters')
const AUTH_TOKEN = configuredToken ?? crypto.randomUUID()
const AUTH_HEADER = `${AUTH_COOKIE}=${AUTH_TOKEN}; HttpOnly; SameSite=Strict; Path=/`

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const WEB_DIST = resolve(__dirname, '../../web/dist')

const modelRuntime = await ModelRuntime.create()

type AgentSession = Awaited<ReturnType<typeof createAgentSession>>['session']

interface Managed {
  key: string
  session: AgentSession
}

const pool = new Map<string, Managed>()

// ---------- SSE client registry ----------

const sseClients = new Set<ServerResponse>()

function sseWrite(res: ServerResponse, msg: ServerMessage) {
  res.write(`data: ${JSON.stringify(msg)}\n\n`)
}

function broadcast(msg: ServerMessage) {
  for (const res of sseClients)
    sseWrite(res, msg)
}

function modelInfo(session: AgentSession): ModelInfo | null {
  const m = session.model
  return m ? { id: m.id, name: m.name, provider: m.provider } : null
}

function sessionState(m: Managed): SessionState {
  return {
    key: m.key,
    sessionId: m.session.sessionId,
    sessionFile: m.session.sessionFile ?? null,
    isStreaming: m.session.isStreaming,
    model: modelInfo(m.session),
    thinkingLevel: m.session.thinkingLevel,
    thinkingLevels: m.session.getAvailableThinkingLevels(),
    context: (m.session.getContextUsage() ?? null) as SessionContext | null,
    messages: m.session.messages as ChatMessage[],
  }
}

async function openSession(opts: { path?: string, cwd?: string, fresh?: boolean }): Promise<Managed> {
  const key = opts.path ?? (opts.fresh ? `new:${crypto.randomUUID()}` : `new:${opts.cwd ?? ROOT_CWD}`)
  const existing = pool.get(key)
  if (existing)
    return existing

  const cwd = opts.cwd ?? ROOT_CWD
  const sessionManager = opts.path
    ? SessionManager.open(opts.path)
    : SessionManager.create(cwd)

  const { session } = await createAgentSession({
    cwd,
    sessionManager,
    modelRuntime,
  })

  const managed: Managed = { key, session }
  pool.set(key, managed)

  session.subscribe((event) => {
    const context = ['message_end', 'compaction_end', 'agent_settled'].includes(event.type)
      ? (session.getContextUsage() ?? null) as SessionContext | null
      : undefined
    broadcast({ type: 'event', session: key, event: event as AgentEvent, context })
  })

  return managed
}

async function listSessions(): Promise<SessionInfoLite[]> {
  const all = await SessionManager.listAll()
  return all
    .map(s => ({
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name ?? null,
      created: s.created.toISOString(),
      modified: s.modified.toISOString(),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage.slice(0, 120),
    }))
    .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
}

async function listDirectories(path: string): Promise<DirectoryListing> {
  const directory = await realpath(resolve(path))
  const info = await stat(directory)
  if (!info.isDirectory())
    throw new Error('path is not a directory')
  const entries = await readdir(directory, { withFileTypes: true })
  const directories = entries
    .filter(entry => entry.isDirectory())
    .map(entry => ({ name: entry.name, path: join(directory, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const parent = dirname(directory)
  return {
    path: directory,
    parent: parent === directory ? null : parent,
    directories,
  }
}

// ---------- HTTP helpers ----------

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(data))
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 1_000_000)
      throw new Error('request body too large')
  }
  return body ? JSON.parse(body) : {}
}

function hasTrustedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined)
    return true
  return isAllowedOrigin(origin, req.headers.host)
}

function isAuthenticated(req: IncomingMessage): boolean {
  return hasAuthCookie(req.headers.cookie, AUTH_TOKEN)
}

// ---------- API routes ----------

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname
  const method = req.method ?? 'GET'

  if (method === 'GET' && path === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.flushHeaders()
    sseClients.add(res)
    sseWrite(res, { type: 'hello', cwd: ROOT_CWD })
    const heartbeat = setInterval(() => res.write(': hb\n\n'), 25_000)
    req.on('close', () => {
      clearInterval(heartbeat)
      sseClients.delete(res)
    })
    return
  }

  if (method === 'GET' && path === '/api/hello')
    return json(res, 200, { cwd: ROOT_CWD } satisfies HelloResponse)

  if (method === 'GET' && path === '/api/sessions')
    return json(res, 200, { sessions: await listSessions() } satisfies SessionsResponse)

  if (method === 'GET' && path === '/api/models') {
    const models: ModelInfo[] = (await modelRuntime.getAvailable()).map(m => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
    }))
    return json(res, 200, { models } satisfies ModelsResponse)
  }

  if (method === 'GET' && path === '/api/directories') {
    return json(res, 200, {
      listing: await listDirectories(url.searchParams.get('path') ?? ROOT_CWD),
    } satisfies DirectoriesResponse)
  }

  if (method === 'GET' && path === '/api/usage') {
    const key = url.searchParams.get('key')
    const managed = key ? pool.get(key) : undefined
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

  if (method === 'POST' && path === '/api/sessions/open') {
    const body = await readBody(req)
    if (typeof body.path !== 'string')
      return json(res, 400, { error: 'path required' })
    const known = (await SessionManager.listAll()).find(session => session.path === body.path)
    if (!known)
      return json(res, 404, { error: 'session not found' })
    const managed = await openSession({ path: known.path, cwd: known.cwd })
    return json(res, 200, { state: sessionState(managed) } satisfies SessionStateResponse)
  }

  if (method === 'POST' && path === '/api/sessions/new') {
    const body = await readBody(req)
    const cwd = typeof body.cwd === 'string' ? (await listDirectories(body.cwd)).path : ROOT_CWD
    const managed = await openSession({ cwd, fresh: true })
    return json(res, 200, { state: sessionState(managed) } satisfies SessionStateResponse)
  }

  const action = path.match(/^\/api\/sessions\/([^/]+)\/(prompt|abort|model|thinking)$/)
  if (method === 'POST' && action) {
    const key = decodeURIComponent(action[1]!)
    const managed = pool.get(key)
    if (!managed)
      return json(res, 404, { error: `session not open: ${key}` })
    const body = await readBody(req)

    switch (action[2]) {
      case 'prompt': {
        if (typeof body.text !== 'string' || !body.text.trim())
          return json(res, 400, { error: 'text required' })
        // respond immediately; progress arrives over SSE
        json(res, 202, { ok: true })
        const { session } = managed
        void (async () => {
          // Enter while streaming = steer (delivered after current turn)
          try {
            await session.prompt(body.text as string, {
              streamingBehavior: session.isStreaming ? 'steer' : undefined,
            })
          }
          catch (err) {
            broadcast({ type: 'error', session: key, error: String(err) })
          }
          broadcast({ type: 'state', state: sessionState(managed) })
          broadcast({ type: 'sessions', sessions: await listSessions() })
        })()
        return
      }

      case 'abort':
        await managed.session.abort()
        return json(res, 200, { ok: true })

      case 'model': {
        const model = modelRuntime
          .getAvailableSnapshot()
          .find(m => m.provider === body.provider && m.id === body.modelId)
        if (!model)
          return json(res, 404, { error: `model not found: ${String(body.provider)}/${String(body.modelId)}` })
        await managed.session.setModel(model)
        broadcast({ type: 'state', state: sessionState(managed) })
        return json(res, 200, { ok: true })
      }

      case 'thinking': {
        const level = managed.session.getAvailableThinkingLevels().find(level => level === body.level)
        if (!level)
          return json(res, 400, { error: 'unknown thinking level' })
        managed.session.setThinkingLevel(level)
        broadcast({ type: 'state', state: sessionState(managed) })
        return json(res, 200, { ok: true })
      }
    }
  }

  json(res, 404, { error: 'not found' })
}

// ---------- static ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

async function serveStatic(res: ServerResponse, path: string) {
  let file = normalize(join(WEB_DIST, path))
  if (!file.startsWith(WEB_DIST)) {
    res.writeHead(403).end()
    return
  }
  if (path === '/' || !existsSync(file))
    file = join(WEB_DIST, 'index.html')
  try {
    const body = await readFile(file)
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
    })
    res.end(body)
  }
  catch {
    res.writeHead(404).end()
  }
}

// ---------- server ----------

const httpServer = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const path = url.pathname

    if (path === '/auth') {
      if (!hasTrustedOrigin(req)) {
        res.writeHead(403, { 'cache-control': 'no-store' }).end()
        return
      }
      const suppliedToken = url.searchParams.get('token')
      const authenticated = IS_LOOPBACK
        || suppliedToken === AUTH_TOKEN
        || isAuthenticated(req)
      if (!authenticated) {
        res.writeHead(401, { 'cache-control': 'no-store' }).end()
        return
      }
      res.writeHead(204, {
        'cache-control': 'no-store',
        'set-cookie': AUTH_HEADER,
      }).end()
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
        await handleApi(req, res, url)
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
})

httpServer.listen(PORT, HOST, () => {
  console.info(`piflow · http://${HOST}:${PORT}`)
})
