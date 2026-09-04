# SDK Runtime and Protocol Alignment Plan

Date: 2026-09-05

Status: accepted -- supersedes the RPC subprocess migration draft.

## Decision

piflow embeds pi through its in-process SDK. Each resident piflow session owns
one pi `AgentSessionRuntime`; `runtime.session` is the sole source of truth for
agent state.

piflow does not provide an RPC driver, a dual-driver abstraction, or one pi
subprocess per session. Server restarts do not preserve running tasks. Ordinary
agent failures must stay local to their session, while process-level failures
such as OOM or native crashes may restart the server.

This matches piflow's role as a Node.js host that needs native custom tools and
does not require task survival across server restarts. pi-web independently
validates the in-process SDK approach; pichamber's dual driver serves a
different IDE integration model.

## Native pi boundaries

Use pi concepts directly from the package that owns them. Do not rename,
mirror, or convenience-re-export them through `@piflow/protocol`:

- `AgentMessage`, `AgentToolResult`, and `ThinkingLevel` from pi-agent-core;
- `ModelInfo`, `AgentSessionRuntime`, `AgentSessionEvent`, `ContextUsage`,
  `JsonAgentSessionEvent`, `RpcExtensionUIRequest`, and
  `RpcExtensionUIResponse` from pi-coding-agent.

`@piflow/protocol` owns only piflow product data and network routing: Flow
documents, provider quota reports, session status, ISO-string session-list
projections, HTTP request/response bodies, and SSE envelopes.

The browser model list uses pi's `ModelInfo`. The server explicitly projects
only `provider`, `id`, `contextWindow`, and `reasoning`; it must not expose a
full `Model<Api>` because that also carries `baseUrl`, headers, compatibility
configuration, and other server-only data. The UI displays the model id.

Dependencies remain `^0.84.4` with the committed `pnpm-lock.yaml`. Upgrades are
reviewed through lockfile changes rather than exact package.json pins.

## Session runtime

Each pool entry contains an `AgentSessionRuntime` and session-local Extension
UI state. Runtime creation follows pi's native factory pattern:

1. create cwd-bound `AgentSessionServices`;
2. create the session from those services with Flow `customTools`;
3. wrap it in `AgentSessionRuntime`;
4. bind extensions and subscribe to `runtime.session`;
5. rebind both whenever the runtime replaces its session.

Services are not shared between sessions. In particular, each runtime owns its
`ModelRuntime`, `SettingsManager`, and `ResourceLoader`, preventing project
extensions and provider registration from leaking between cwd values.

Use `AgentSessionRuntime.dispose()` for teardown so extensions receive
`session_shutdown` before the session is invalidated. Browser disconnects do
not dispose sessions. Sessions are disposed only by deletion, server shutdown,
or pool eviction.

Forking uses `runtime.fork(entryId)`. The resulting runtime is re-keyed to the
new fork path and returned to the browser; the original session becomes
non-resident and is reopened on demand. This preserves pi's extension
lifecycle instead of editing JSONL files behind a live runtime.

## Session pool

`PIFLOW_SESSION_POOL_SIZE` is a soft total limit and defaults to `16`.

When the pool exceeds the limit, evict least-recently-used entries only when
all of the following hold:

- the session is persisted;
- the agent is not streaming or compacting;
- no Extension UI dialog is pending.

Running, pending-dialog, and unpersisted sessions are never evicted. They may
temporarily push the pool above the limit. Do not abort work, queue activation,
or add TTL timers. Concurrent opens of the same session share one creation
promise.

An idle agent loop is not a closed session. `agent_settled` only means the
current loop completed; the runtime still owns messages, model, thinking
level, extensions, and queues.

## Models

There is no process-global `ModelRuntime`. `GET /api/models?key=<session>`
reads the selected session's `runtime.services.modelRuntime` and returns pi
`ModelInfo` projections. The Web client refreshes this list when its active
session changes. Model changes resolve the selected model against that same
runtime.

## Flow

Flow remains an in-process SDK integration:

- register Flow tools through `customTools`;
- inject `flow_directory` with native `sendCustomMessage()`;
- use `followUp()` for a busy target and `prompt()` for an idle target;
- never use `steer()` for messages sent by another agent;
- keep topology user-owned and enforce edge and hop authorization server-side.

`search_flow_context` and `read_flow_context` must not activate a runtime.
Read `runtime.session.messages` when resident; otherwise use
`SessionManager.open(...).buildSessionContext().messages`. Only
`send_flow_message` activates the target runtime.

Do not create a disk extension, loopback callback, callback token, or
`flow-bridge`. The hidden `flow_directory` message remains necessary to solve
tool-discovery startup ordering.

## Extension UI

Replace `ui-bridge.ts` with a thin `extension-ui.ts` that directly implements
pi's `ExtensionUIContext`. Bind it in `rpc` mode because that is pi's official
portable headless UI contract; no `RpcClient` is involved.

Use `RpcExtensionUIRequest` and `RpcExtensionUIResponse` as the existing pi
wire DTOs. Add only the piflow `session` routing field, flat on the frame.
Do not add aliases, nested request wrappers, ANSI cleaning, or private pi API
access. The Web theme returns unstyled text and Markdown remains behind
`rehype-sanitize`.

Portable behavior:

- `select`, `confirm`, `input`, and `editor` suspend until response, timeout,
  abort, or runtime teardown;
- `notify` is fire-and-forget and is not replayed;
- `setStatus` and string-array `setWidget` are retained in the session UI
  snapshot;
- `setTitle` and `set_editor_text` are immediate browser commands and are not
  replayed;
- `pasteToEditor` follows RPC mode and degrades to `setEditorText`;
- TUI-only component, raw-input, loader, theme-selection, autocomplete, and
  editor-component APIs use the same no-op/default behavior as pi RPC mode.

Pending dialogs are suspended extension promises, not messages or prompts.
The first response wins; duplicate responses are silently ignored. Whenever
the pending set changes, publish the existing session state snapshot so the
current browser observes server-side timeout and abort. This is not a separate
multi-tab settlement protocol.

## Events and Web projection

Subscribe to native `AgentSessionEvent` and send official
`JsonAgentSessionEvent`. pi 0.84.4 does not export `toJsonEvent()`, so keep one
small, tested, source-equivalent local conversion and delete it when upstream
exports the helper.

Do not JSON-serialize native `message_update` directly: its repeated full
partial message makes streaming transport approach quadratic size. The JSON
event carries the assistant delta without `partial`. SSE adds only the flat
session routing envelope.

The Web reducer is a disposable projection, never an authoritative agent
state. On first connection and reconnect, emit an immediate state snapshot for
every resident runtime, reading messages, streaming/error state, model,
thinking level, context usage, queue, and Extension UI state directly from the
session. Do not add an event log, sequence protocol, server-side message copy,
or resync state machine.

Session status is derived as follows:

- `running`: `session.isStreaming`;
- `failed`: `session.errorMessage !== undefined`;
- `needsInput`: at least one pending Extension UI dialog;
- a session not resident in this server process is treated as idle.

## Project trust and extension management

Creating services may execute project extensions. Reuse
`hasTrustRequiringProjectResources()` and `ProjectTrustStore`; piflow and the
pi CLI share the same trust decisions. Untrusted projects start in restricted
mode without project resources. The Web UI may explicitly trust a project,
then recreate its idle runtimes.

Extension management is cwd- and scope-aware and continues to use pi's
`SettingsManager` and `DefaultPackageManager`. Project-scope changes require a
trusted project. Before installing or removing an extension, reject with
`409` if any affected runtime is running or has a pending dialog. Otherwise
persist the change and reload affected sessions. Global changes affect every
runtime; project changes affect only matching cwd values. Do not maintain a
deferred-reload state machine.

## Verification

Focused tests cover:

- source-equivalent JSON event conversion;
- dialog response, timeout, abort, duplicate response, and reconnect state;
- status/widget state and immediate title/editor commands;
- LRU eviction of only persisted safe idle sessions;
- concurrent session activation;
- Flow reads without runtime activation and busy-target `followUp`;
- project trust gating;
- extension mutation rejection while affected sessions are busy;
- failure in session A does not prevent prompting session B.

Finish with `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm build`.

## Watch list

- pi exports `toJsonEvent()`;
- pi exports its RPC `createExtensionUIContext()`;
- pi-server gains a host API that preserves in-process custom tools and the
  required trust/auth semantics.
