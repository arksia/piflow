import { reactive } from "vue";

export interface SessionInfoLite {
  path: string;
  id: string;
  cwd: string;
  name: string | null;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

export interface ToolState {
  running?: boolean;
  args?: unknown;
  partial?: { content?: Array<{ type: string; text?: string }> };
  result?: { content?: Array<{ type: string; text?: string }>; details?: Record<string, unknown> };
  isError?: boolean;
}

export interface SessionView {
  key: string;
  messages: any[];
  live: any | null;
  isStreaming: boolean;
  isCompacting: boolean;
  model: ModelInfo | null;
  thinkingLevel: string | null;
  thinkingLevels: string[];
  toolResults: Record<string, ToolState>;
  queue: { steering: readonly string[]; followUp: readonly string[] };
  error: string | null;
  tick: number;
}

export const store = reactive({
  connected: false,
  cwd: "",
  sessions: [] as SessionInfoLite[],
  models: [] as ModelInfo[],
  activeKey: null as string | null,
  draft: "",
  views: {} as Record<string, SessionView>,
  sidebarOpen: false,
});

function ensureView(key: string): SessionView {
  return (store.views[key] ??= {
    key,
    messages: [],
    live: null,
    isStreaming: false,
    isCompacting: false,
    model: null,
    thinkingLevel: null,
    thinkingLevels: [],
    toolResults: {},
    queue: { steering: [], followUp: [] },
    error: null,
    tick: 0,
  });
}

// ---------- ws connection ----------

let ws: WebSocket | null = null;
const stateResolvers: Array<(state: any) => void> = [];

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    store.connected = true;
    send({ type: "list_sessions" });
    send({ type: "list_models" });
  };
  ws.onclose = () => {
    store.connected = false;
    ws = null;
    setTimeout(connect, 1500);
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data));
    route(msg);
  };
}

function send(msg: Record<string, unknown>) {
  ws?.send(JSON.stringify(msg));
}

function route(msg: any) {
  switch (msg.type) {
    case "hello":
      store.cwd = msg.cwd;
      break;

    case "sessions":
      store.sessions = msg.sessions;
      break;

    case "models":
      store.models = msg.models;
      break;

    case "state": {
      const s = msg.state;
      const view = ensureView(s.key);
      view.messages = s.messages;
      view.isStreaming = s.isStreaming;
      view.model = s.model;
      view.thinkingLevel = s.thinkingLevel ?? null;
      view.thinkingLevels = s.thinkingLevels ?? [];
      view.error = null;
      // rebuild tool results from history
      const results: Record<string, ToolState> = {};
      for (const m of s.messages) {
        if (m.role === "toolResult" && m.toolCallId) {
          results[m.toolCallId] = { result: { content: m.content, details: m.details }, isError: m.isError };
        }
      }
      // ponytail: single-user local tool; full message sync via state broadcast
      view.toolResults = results;
      view.tick++;
      // resolve pending open/new (only direct replies, not broadcasts)
      if (msg.reply) {
        const r = stateResolvers.shift();
        if (r) r(s);
      }
      break;
    }

    case "event":
      handleEvent(msg.session, msg.event);
      break;

    case "error": {
      if (msg.session) ensureView(msg.session).error = msg.error;
      console.error("[piflow]", msg.error);
      break;
    }
  }
}

function sameMessage(a: any, b: any) {
  return a && b && a.role === b.role && JSON.stringify(a.content) === JSON.stringify(b.content);
}

function handleEvent(key: string, ev: any) {
  const view = ensureView(key);
  view.tick++;

  switch (ev.type) {
    case "agent_start":
      view.isStreaming = true;
      view.error = null;
      break;

    case "agent_settled":
      view.isStreaming = false;
      view.live = null;
      break;

    case "message_start":
      if (ev.message?.role === "assistant") view.live = ev.message;
      break;

    case "message_update":
      if (ev.message?.role === "assistant") view.live = ev.message;
      break;

    case "message_end": {
      const m = ev.message;
      if (!m) break;
      if (m.role === "assistant") {
        view.live = null;
        const last = view.messages[view.messages.length - 1];
        if (!sameMessage(last, m)) view.messages.push(m);
      }
      break;
    }

    case "tool_execution_start":
      view.toolResults[ev.toolCallId] = { running: true, args: ev.args };
      break;

    case "tool_execution_update": {
      const t = (view.toolResults[ev.toolCallId] ??= {});
      t.partial = ev.partialResult;
      break;
    }

    case "tool_execution_end":
      view.toolResults[ev.toolCallId] = { result: ev.result, isError: ev.isError };
      break;

    case "compaction_start":
      view.isCompacting = true;
      break;

    case "compaction_end":
      view.isCompacting = false;
      break;

    case "queue_update":
      view.queue = { steering: ev.steering, followUp: ev.followUp };
      break;
  }
}

// ---------- public API ----------

export function requestSessions() {
  send({ type: "list_sessions" });
}

export function openSession(path: string, cwd?: string): Promise<any> {
  return new Promise((resolve) => {
    stateResolvers.push((state) => {
      store.activeKey = state.key;
      resolve(state);
    });
    send({ type: "open", path, cwd });
  });
}

export function newSession(cwd?: string): Promise<any> {
  return new Promise((resolve) => {
    stateResolvers.push((state) => {
      store.activeKey = state.key;
      resolve(state);
    });
    send({ type: "new", cwd });
  });
}

export async function sendPrompt(text: string) {
  if (!store.activeKey) await newSession();
  const key = store.activeKey!;
  const view = ensureView(key);
  // optimistic echo
  view.messages.push({ role: "user", content: text, timestamp: Date.now() });
  view.tick++;
  send({ type: "prompt", key, text });
}

export function abort(key: string) {
  send({ type: "abort", key });
}

export function setModel(key: string, provider: string, modelId: string) {
  send({ type: "set_model", key, provider, modelId });
}

export function setThinking(key: string, level: string) {
  send({ type: "set_thinking", key, level });
}

export function initWs() {
  connect();
}
