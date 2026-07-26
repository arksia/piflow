import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  ModelRuntime,
  SessionManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import { getUsage } from "./usage/index.js";

const PORT = Number(process.env.PORT ?? 3141);
const HOST = process.env.HOST ?? "127.0.0.1";
const ROOT_CWD = process.cwd();

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const WEB_DIST = resolve(__dirname, "../../web/dist");

const modelRuntime = await ModelRuntime.create();

type AgentSession = Awaited<ReturnType<typeof createAgentSession>>["session"];

interface Managed {
  key: string;
  session: AgentSession;
}

const pool = new Map<string, Managed>();
const clients = new Set<WebSocket>();

function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg: unknown) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function modelInfo(session: AgentSession) {
  const m = session.model;
  return m ? { id: m.id, name: m.name, provider: m.provider } : null;
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
    messages: m.session.messages,
  };
}

async function openSession(opts: { path?: string; cwd?: string; fresh?: boolean }): Promise<Managed> {
  const key = opts.path ?? (opts.fresh ? `new:${crypto.randomUUID()}` : `new:${opts.cwd ?? ROOT_CWD}`);
  const existing = pool.get(key);
  if (existing) return existing;

  const cwd = opts.cwd ?? ROOT_CWD;
  const sessionManager = opts.path
    ? SessionManager.open(opts.path)
    : SessionManager.create(cwd);

  const { session } = await createAgentSession({
    cwd,
    sessionManager,
    modelRuntime,
  });

  const managed: Managed = { key, session };
  pool.set(key, managed);

  session.subscribe((event) => {
    broadcast({ type: "event", session: key, event });
  });

  return managed;
}

async function listSessions() {
  const all = await SessionManager.listAll();
  return all
    .map((s) => ({
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name ?? null,
      created: s.created,
      modified: s.modified,
      messageCount: s.messageCount,
      firstMessage: s.firstMessage.slice(0, 120),
    }))
    .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
}

interface ClientMessage {
  type: string;
  key?: string;
  path?: string;
  cwd?: string;
  text?: string;
  provider?: string;
  modelId?: string;
  level?: string;
}

async function handle(ws: WebSocket, msg: ClientMessage) {
  switch (msg.type) {
    case "list_sessions": {
      send(ws, { type: "sessions", sessions: await listSessions() });
      break;
    }

    case "open": {
      const managed = await openSession({ path: msg.path, cwd: msg.cwd });
      send(ws, { type: "state", reply: true, state: sessionState(managed) });
      break;
    }

    case "new": {
      const managed = await openSession({ cwd: msg.cwd, fresh: true });
      send(ws, { type: "state", reply: true, state: sessionState(managed) });
      break;
    }

    case "prompt": {
      if (!msg.key || typeof msg.text !== "string") return;
      const managed = pool.get(msg.key);
      if (!managed) {
        send(ws, { type: "error", error: `session not open: ${msg.key}` });
        return;
      }
      const { session } = managed;
      // Enter while streaming = steer (delivered after current turn)
      await session.prompt(msg.text, {
        streamingBehavior: session.isStreaming ? "steer" : undefined,
      }).catch((err: unknown) => {
        broadcast({ type: "error", session: msg.key, error: String(err) });
      });
      // refresh state (messages, streaming flag)
      broadcast({ type: "state", state: sessionState(managed) });
      broadcast({ type: "sessions", sessions: await listSessions() });
      break;
    }

    case "list_models": {
      const models = (await modelRuntime.getAvailable()).map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
      }));
      send(ws, { type: "models", models });
      break;
    }

    case "set_model": {
      const managed = msg.key ? pool.get(msg.key) : undefined;
      if (!managed) return;
      const model = modelRuntime
        .getAvailableSnapshot()
        .find((m) => m.provider === msg.provider && m.id === msg.modelId);
      if (!model) {
        send(ws, { type: "error", error: `model not found: ${msg.provider}/${msg.modelId}` });
        return;
      }
      await managed.session.setModel(model);
      broadcast({ type: "state", state: sessionState(managed) });
      break;
    }

    case "set_thinking": {
      const managed = msg.key ? pool.get(msg.key) : undefined;
      if (!managed || !msg.level) return;
      managed.session.setThinkingLevel(msg.level as never);
      broadcast({ type: "state", state: sessionState(managed) });
      break;
    }

    case "get_usage": {
      const managed = msg.key ? pool.get(msg.key) : undefined;
      const provider = managed?.session.model?.provider ?? msg.provider;
      if (!provider) break;
      const report = await getUsage(provider);
      send(ws, {
        type: "usage",
        provider,
        supported: !!report,
        plan: report?.plan,
        windows: report?.windows ?? [],
      });
      break;
    }

    case "abort": {
      const managed = msg.key ? pool.get(msg.key) : undefined;
      await managed?.session.abort();
      break;
    }
  }
}

// ---------- HTTP + static ----------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

const httpServer = createServer(async (req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  let file = normalize(join(WEB_DIST, url));
  if (!file.startsWith(WEB_DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (url === "/" || !existsSync(file)) file = join(WEB_DIST, "index.html");
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (ws) => {
  clients.add(ws);
  send(ws, { type: "hello", cwd: ROOT_CWD });

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      send(ws, { type: "error", error: "invalid JSON" });
      return;
    }
    handle(ws, msg).catch((err: unknown) => {
      send(ws, { type: "error", error: String(err), for: msg.type });
    });
  });

  ws.on("close", () => clients.delete(ws));
});

httpServer.listen(PORT, HOST, () => {
  console.log(`piflow · http://${HOST}:${PORT}`);
});
