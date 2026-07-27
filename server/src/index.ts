import type { ClientMessage } from './protocol.js'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { WebSocket, WebSocketServer } from 'ws'
import {
  AUTH_COOKIE,

  hasAuthCookie,
  isAllowedOrigin,
  isLoopbackHost,
  isValidAccessToken,
  parseClientMessage,
} from './protocol.js'
import { getUsage } from './usage/index.js'

const PORT = Number(process.env.PORT ?? 3141)
const HOST = process.env.HOST ?? '127.0.0.1'
const ROOT_CWD = process.cwd()
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
const clients = new Set<WebSocket>()

function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(msg))
}

function broadcast(msg: unknown) {
  const data = JSON.stringify(msg)
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(data)
  }
}

function modelInfo(session: AgentSession) {
  const m = session.model
  return m ? { id: m.id, name: m.name, provider: m.provider } : null
}

function sessionState(m: Managed) {
  return {
    key: m.key,
    sessionId: m.session.sessionId,
    sessionFile: m.session.sessionFile ?? null,
    isStreaming: m.session.isStreaming,
    model: modelInfo(m.session),
    thinkingLevel: m.session.thinkingLevel,
    thinkingLevels: m.session.getAvailableThinkingLevels(),
    context: m.session.getContextUsage() ?? null,
    messages: m.session.messages,
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
      ? session.getContextUsage() ?? null
      : undefined
    broadcast({ type: 'event', session: key, event, context })
  })

  return managed
}

async function listSessions() {
  const all = await SessionManager.listAll()
  return all
    .map(s => ({
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name ?? null,
      created: s.created,
      modified: s.modified,
      messageCount: s.messageCount,
      firstMessage: s.firstMessage.slice(0, 120),
    }))
    .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
}

async function handle(ws: WebSocket, msg: ClientMessage) {
  switch (msg.type) {
    case 'list_sessions': {
      send(ws, { type: 'sessions', sessions: await listSessions() })
      break
    }

    case 'open': {
      const known = (await SessionManager.listAll()).find(session => session.path === msg.path)
      if (!known) {
        send(ws, { type: 'error', requestId: msg.requestId, error: 'session not found' })
        return
      }
      const managed = await openSession({ path: known.path, cwd: known.cwd })
      send(ws, { type: 'state', requestId: msg.requestId, state: sessionState(managed) })
      break
    }

    case 'new': {
      const managed = await openSession({ cwd: ROOT_CWD, fresh: true })
      send(ws, { type: 'state', requestId: msg.requestId, state: sessionState(managed) })
      break
    }

    case 'prompt': {
      if (!msg.key || typeof msg.text !== 'string')
        return
      const managed = pool.get(msg.key)
      if (!managed) {
        send(ws, { type: 'error', error: `session not open: ${msg.key}` })
        return
      }
      const { session } = managed
      // Enter while streaming = steer (delivered after current turn)
      await session.prompt(msg.text, {
        streamingBehavior: session.isStreaming ? 'steer' : undefined,
      }).catch((err: unknown) => {
        broadcast({ type: 'error', session: msg.key, error: String(err) })
      })
      // refresh state (messages, streaming flag)
      broadcast({ type: 'state', state: sessionState(managed) })
      broadcast({ type: 'sessions', sessions: await listSessions() })
      break
    }

    case 'list_models': {
      const models = (await modelRuntime.getAvailable()).map(m => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
      }))
      send(ws, { type: 'models', models })
      break
    }

    case 'set_model': {
      const managed = msg.key ? pool.get(msg.key) : undefined
      if (!managed)
        return
      const model = modelRuntime
        .getAvailableSnapshot()
        .find(m => m.provider === msg.provider && m.id === msg.modelId)
      if (!model) {
        send(ws, { type: 'error', error: `model not found: ${msg.provider}/${msg.modelId}` })
        return
      }
      await managed.session.setModel(model)
      broadcast({ type: 'state', state: sessionState(managed) })
      break
    }

    case 'set_thinking': {
      const managed = msg.key ? pool.get(msg.key) : undefined
      if (!managed || !msg.level)
        return
      const level = managed.session.getAvailableThinkingLevels().find(level => level === msg.level)
      if (!level)
        return
      managed.session.setThinkingLevel(level)
      broadcast({ type: 'state', state: sessionState(managed) })
      break
    }

    case 'get_usage': {
      const managed = msg.key ? pool.get(msg.key) : undefined
      const provider = managed?.session.model?.provider ?? msg.provider
      if (!provider)
        break
      const report = await getUsage(provider, msg.fresh)
      send(ws, {
        type: 'usage',
        provider,
        supported: !!report,
        plan: report?.plan,
        windows: report?.windows ?? [],
      })
      break
    }

    case 'abort': {
      const managed = msg.key ? pool.get(msg.key) : undefined
      await managed?.session.abort()
      break
    }
  }
}

// ---------- HTTP + static ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

const httpServer = createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const url = requestUrl.pathname
  if (url === '/auth') {
    const suppliedToken = requestUrl.searchParams.get('token')
    const authenticated = IS_LOOPBACK
      || suppliedToken === AUTH_TOKEN
      || hasAuthCookie(req.headers.cookie, AUTH_TOKEN)
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
  let file = normalize(join(WEB_DIST, url))
  if (!file.startsWith(WEB_DIST)) {
    res.writeHead(403).end()
    return
  }
  if (url === '/' || !existsSync(file))
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
})

const verifyClient: WebSocket.VerifyClientCallbackSync = ({ origin, req }) =>
  isAllowedOrigin(origin, req.headers.host)
  && hasAuthCookie(req.headers.cookie, AUTH_TOKEN)

const wss = new WebSocketServer({
  server: httpServer,
  path: '/ws',
  maxPayload: 1024 * 1024,
  verifyClient,
})

wss.on('connection', (ws) => {
  clients.add(ws)
  send(ws, { type: 'hello', cwd: ROOT_CWD })

  ws.on('message', (raw) => {
    const msg = parseClientMessage(String(raw))
    if (!msg) {
      send(ws, { type: 'error', error: 'invalid message' })
      return
    }
    handle(ws, msg).catch((err: unknown) => {
      send(ws, {
        type: 'error',
        error: String(err),
        for: msg.type,
        requestId: 'requestId' in msg ? msg.requestId : undefined,
      })
    })
  })

  ws.on('close', () => clients.delete(ws))
})

httpServer.listen(PORT, HOST, () => {
  console.info(`piflow · http://${HOST}:${PORT}`)
})
