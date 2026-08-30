# RPC Driver Migration & Protocol Alignment Plan

Date: 2026-02-10

Status: v2 — supersedes the SDK-alignment-only draft (pi upgrade to 0.84.4
already landed in `6a83977`).

## Decision

piflow switches its session driver from in-process SDK embedding
(`createAgentSession`) to pi's official **RPC subprocess mode** (`RpcClient`,
one `pi` process per active session).

Rationale: piflow is fundamentally a UI project, and RPC is the embedding
path pi invests in for UIs — official `JsonAgentSessionEvent` wire events,
`RpcExtensionUIRequest` frames, typed command API, and process isolation per
session. pichamber validates the pattern end-to-end.

Verified against pi 0.84 sources:

- `RpcClient`: `prompt`/`steer`/`followUp`/`abort`, `fork(entryId)`,
  `setSessionName`, `switch_session`, `getState`, `getMessages`,
  `onEvent(JsonAgentSessionEvent)`.
- CLI `--extension <path>` loads disk extensions in RPC mode.
- `before_agent_start` extension hook may return
  `{ message: { customType, content, display, details } }` — official
  replacement for `sendCustomMessage` (flow_directory injection).
- RPC command table has **no** custom-message command, and tools cannot be
  injected as closures into a subprocess — Flow tools must become a disk
  extension that calls back to piflow server over loopback HTTP.

## Target architecture

```
piflow-server (one Node process)
├── SessionManager (pi SDK, file ops only: list / rename / delete / fork points)
├── RpcClient pool — one pi subprocess per active session
│     events: JsonAgentSessionEvent (official, no vendored toJsonEvent)
│     extension UI: RpcExtensionUIRequest frames, forwarded + sanitized
├── POST /api/flow/deliver — Flow callback endpoint (loopback, scoped token)
└── packages/builtin-extensions/flow-bridge  (loaded via --extension)
      ├── list_flow_connections / search_flow_context / read_flow_context
      │     → read flow.json + session JSONL files directly from disk
      ├── send_flow_message → POST /api/flow/deliver → server → target RpcClient.prompt()
      └── before_agent_start → read flow.json, return flow_directory custom message
```

Per-subprocess env carries `PIFLOW_SERVER` (loopback base URL) and a scoped
`PIFLOW_FLOW_TOKEN`. Threat note: env is readable by same-user processes;
loopback-only acceptance, same as today's token model.

## Phase 1 — RPC driver vertical slice (server + web together)

One coherent slice: single-session flows work end-to-end on RPC. Flow tools
temporarily absent (Flow canvas stays visible, dispatch disabled).

Server:

- Rewrite `core/sessions.ts` around an `RpcClient` pool: spawn per session
  (`cliPath`, `cwd`, `args: ['--session', file]` when opening saved),
  dispose = kill child. Keep the existing pool key semantics
  (`new:*` vs session-file path).
- Keep `SessionManager` for file-level ops: `listAll`, `appendSessionInfo`
  (rename), delete, fork-point listing. Fork itself goes through
  `client.fork(entryId)`, then spawn a new client for the branched file.
- Status tracking (`idle/running/failed`, `needsInputAt`) stays, driven by
  `agent_start`/`agent_settled` + extension-UI pending state.
- Replace `extensions/ui-bridge.ts` with frame forwarding: RPC delivers
  `extension_ui_request` frames natively; server sanitizes (TUI formatting →
  plain text, cf. pichamber `sanitizeUiRequest`) and relays
  `extension_ui_response` back.
- `/api/models` keeps using server-side `ModelRuntime` (headless, shared).

Protocol (`@piflow/protocol`):

- `AgentEvent` → `JsonAgentSessionEvent` (type re-export).
- `ChatMessage`/`MessageBlock`/… → `AgentMessage` from pi-agent-core.
- `ExtensionUIRequest`/`ExtensionUIResponse` → `RpcExtensionUIRequest` /
  `RpcExtensionUIResponse`.
- Keep owned: `Flow*`, `SessionStatusRecord`, `UsageReport`, `ServerMessage`
  envelope, `SessionInfoLite` (pi's `SessionInfo.created` is a `Date` — keep
  the ISO-string projection), `ModelInfo`, route constants.
- pi packages become `devDependencies` of protocol (type-only).

Web:

- Reducer (`session/reducer.ts`) switches to delta mode: `message_update`
  carries only `assistantMessageEvent`; rebuild `view.live` by applying
  `text_delta`/`thinking_delta`/`toolcall_*` at `contentIndex`. Reference:
  pichamber `packages/web/src/composables/useConversationSession.ts`.
- Drop defensive `if (!event.x) break` checks — the discriminated union
  narrows.
- eslint guardrail: ban value imports of `@earendil-works/*` in web
  (type imports allowed).

Verify: `pnpm typecheck && pnpm test && pnpm lint`; manual smoke — prompt,
streaming render (text/thinking/tool calls), steer, abort, fork, rename,
delete, extension dialog round-trip.

## Phase 2 — Flow restored via bridge extension

- New `packages/builtin-extensions/flow-bridge` (loaded into every spawned
  session via `--extension`):
  - `list_flow_connections` / `read_flow_context` / `search_flow_context`:
    read `flow.json` + peer session JSONL files from disk (pi persists on
    `message_end`; searching "prior work" tolerates the in-flight gap).
  - `send_flow_message`: POST to `/api/flow/deliver` with hop/chain metadata;
    server validates topology (user-owned edges, MAX_HOPS) and calls the
    target's `RpcClient.prompt()`.
  - `before_agent_start`: read `flow.json`, return the flow_directory custom
    message (replaces `sessions.ts` `injectFlowDirectory` +
    `flowDirectories` cache; the extension can cache by file mtime).
- Server: new `POST /api/flow/deliver` endpoint; delete `flow/tools.ts` and
  the `createFlowTools` wiring in `sessions.ts`.
- Node identity: env `PIFLOW_SESSION_FILE` per subprocess lets the extension
  locate its own node in `flow.json`.

Verify: Flow e2e — connect two nodes, send A→B, search peer context,
hop cap enforced, busy-target follow-up behavior.

## Phase 3 — cleanup

- Delete vendored SDK session plumbing no longer used; server keeps pi
  dependency for `SessionManager` + `ModelRuntime` + types only.
- Update AGENTS.md (`builtin-extensions` now exists; driver architecture
  section) and `docs/flow-technical-design.md` (tool execution path changed:
  in-process closures → bridge extension + callback).
- Optional hardening (separate decision): per-frame `seq` + resync.

## Non-goals

- pi-server / pi-client (CBOR, unix socket) adoption — orthogonal; watch list
  unchanged.
- WebSocket transport; runtime schema validation; multi-user auth.
- Dual-driver mode (pichamber keeps both SDK and RPC) — piflow commits to RPC
  only.

## Watch list (re-evaluate on pi upgrades)

- [ ] pi-protocol: custom message channel, fork/delete commands
- [ ] pi-server: WS/TCP transport, auth story, official `PiServerService` host
- [ ] pi-coding-agent: `toJsonEvent` exported (would have removed the need
      for any vendoring had we stayed on SDK)
- [ ] RPC command table: custom-message command (would simplify
      flow_directory injection)
