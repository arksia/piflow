# Protocol Upstream Alignment Plan

Date: 2026-02-10

Status: Draft — pending Phase 0 feasibility check

## Context

`@piflow/protocol` currently re-defines pi's domain types by hand
(`ChatMessage`, `MessageBlock`, `AgentEvent`, `ExtensionUIRequest`), and the
server bridges the two type systems with unchecked `as` casts
(`packages/server/src/core/sessions.ts`). This creates three problems:

1. **Silent drift**: pi upgrades can rename/remove fields and nothing fails
   until runtime.
2. **Inaccurate wire types**: the wire already carries pi's raw objects, so
   protocol types are approximations that sometimes lie (e.g. `ImageBlock`
   lacks the `data`/`mimeType` fields that are actually transmitted).
3. **O(n²) streaming traffic**: every `message_update` event carries the
   entire cumulative assistant message; the web reducer just replaces
   `view.live` with it.

Two upstream references validate the direction:

- **pi 0.84** ships `JsonAgentSessionEvent` + `toJsonEvent()`
  (`packages/coding-agent/src/modes/json-event.ts`): an official wire-safe
  event shape that strips cumulative `partial` snapshots from streaming
  events (message_start → deltas → authoritative message_end).
- **pichamber** (github.com/AMagicPear/pichamber) demonstrates the target
  pattern end-to-end: a shared package that re-exports official pi types
  (`AgentMessage`, `JsonAgentSessionEvent`, `RpcExtensionUIRequest`), defines
  its own types only for product-specific concepts, and extends official
  types via intersection/`Omit` rather than re-declaration.

## Goal

`@piflow/protocol` becomes a **re-export hub + minimal owned types**:

- Session-sync vocabulary (messages, events, extension UI) comes from pi's
  official types — single source of truth, drift breaks `pnpm typecheck`.
- piflow-owned types remain for what pi does not have: `Flow*`,
  `SessionStatusRecord` / `needsInputAt`, `UsageReport`, `ServerMessage`
  envelope, HTTP route constants, and deliberate serialization projections
  (`SessionInfoLite`, `ModelInfo`).

## Non-goals

- Adopting pi-server / pi-client (unix-socket only, no fork/delete commands,
  no extension-UI channel, no reference host implementation; re-evaluate when
  it matures — see watch list below).
- Adopting pi-protocol's `TranscriptItem` snapshot+delta sync model (requires
  custom-message support upstream first; also a full reducer rewrite).
- WebSocket transport, runtime schema validation, multi-user auth.

## Phase 0 — pi upgrade 0.80.7 → 0.84.x

Prerequisite for everything else (`JsonAgentSessionEvent` only exists ≥0.84).

piflow's pi API surface is small; audit each call site against 0.84:

| Usage | File |
|---|---|
| `ModelRuntime.create` / `getAvailable*` | `core/sessions.ts`, `index.ts` |
| `createAgentSession` / `session.prompt` / `subscribe` / `bindExtensions` / `reload` / `sendCustomMessage` / `getContextUsage` | `core/sessions.ts` |
| `SessionManager` (`open`/`create`/`listAll`/`appendSessionInfo`/`createBranchedSession`/entries) | `core/sessions.ts` |
| `defineTool`, `ToolDefinition` | `flow/tools.ts` |
| `DefaultPackageManager`, `SettingsManager`, `getAgentDir` | `extensions/manager.ts` |
| `ExtensionUIContext`, `Theme` | `extensions/ui-bridge.ts` |

Verify: `pnpm typecheck && pnpm test`, plus manual smoke (prompt, fork,
extension dialog, Flow send).

## Phase 1 — protocol becomes a re-export hub (type alignment, no behavior change)

**Dependencies**: add pi packages as `devDependencies` of `@piflow/protocol`
(type-only; protocol is consumed as source via `exports: ./src/index.ts`, so
types flow into both server and web typechecks — that is the point).

**Replace**:

| Current (hand-written) | Becomes |
|---|---|
| `AgentEvent` | `AgentSessionEvent` from pi-coding-agent (still carries cumulative `message`; reducer unchanged in this phase) |
| `ChatMessage`, `MessageBlock`, `TextBlock`/`ImageBlock`/`ThinkingBlock`/`ToolCallBlock` | `AgentMessage` from pi-agent-core (covers custom messages incl. bash execution, compaction summaries) |
| `ExtensionUIRequest` / `ExtensionUIResponse` | `RpcExtensionUIRequest` / `RpcExtensionUIResponse` (superset of current methods; narrow to what ui-bridge supports if desired) |
| `SessionContext` | derive from `ReturnType<AgentSession['getContextUsage']>` or keep projection if shape diverges |

**Keep owned**: `Flow*`, `SessionStatusRecord`, `UsageReport`, `ServerMessage`
envelope, `SessionInfoLite` (pi's `SessionInfo.created` is a `Date` — not
wire-safe; keep the ISO-string projection), `ModelInfo`, route constants.

**Server cleanup**: delete the three `as` casts in `sessions.ts`
(`messages`, `event`, `getContextUsage`). Any type error that surfaces here
is pre-existing drift — fix the type or fix the mapping, case by case.

**Web guardrail**: eslint `no-restricted-imports` — ban value imports of
`@earendil-works/*` in `packages/web` (type imports allowed). Pi is Node
code; a value import would break the browser bundle.

Verify: `pnpm typecheck && pnpm test && pnpm lint`; web bundle unchanged in
behavior.

## Phase 2 — extension UI bridge alignment

`extensions/ui-bridge.ts` currently defines its own request shape
(`{id, method: 'select'|'confirm'|'input'|'notify', ...}`). Align the wire
frames with pi's official `RpcExtensionUIRequest` discriminated union
(subset: select/confirm/input/notify), as pichamber does — including its
`sanitizeUiRequest` step (RPC extensions may emit TUI-formatted text;
browsers get plain text).

Verify: extension dialog e2e (select/confirm/input/notify round-trip).

## Phase 3 — `toJsonEvent` + delta reducer

The only phase that changes wire behavior.

**Server**: pass events through `toJsonEvent()` before publishing. Removes
cumulative `partial` from `message_update`; `toolcall_start` gets flattened
`id`/`toolName`. Streaming traffic drops from O(n²) to O(n).

**Web reducer** (`session/reducer.ts`): `message_update` handling changes
from "replace `view.live` with `event.message`" to "append
`assistantMessageEvent` delta into `view.live`" (`text_delta` /
`thinking_delta` / `toolcall_delta`, indexed by `contentIndex`).
Reference implementation: pichamber
`packages/web/src/composables/useConversationSession.ts`.

Bonus: the switch to the official discriminated union lets the reducer drop
its defensive `if (!event.toolCallId) break` checks — narrowing makes them
unrepresentable.

Verify: streaming renders identically for text, thinking, tool calls;
long-generation SSE traffic measured before/after.

## Phase 4 (optional) — seq + snapshot resync

Delta streams are loss-sensitive (a dropped frame silently corrupts text).
Mitigation per pichamber / pi-protocol's "snapshots remain authoritative":

- add a monotonically increasing `seq` to every `event` ServerMessage
- web tracks contiguity; on a gap, requests a fresh state snapshot
  (`GET /api/sessions/:key/state` already exists) and rebuilds

Loopback SSE rarely drops frames mid-connection, so this is optional
hardening, not a prerequisite for Phase 3.

## Watch list (re-evaluate on pi upgrades)

Adopt or align with pi-protocol / pi-server when it gains:

- [ ] custom message channel (bash execution, extension messages)
- [ ] fork / rename / delete commands
- [ ] WebSocket or TCP transport + auth story
- [ ] an official `PiServerService` host implementation
- [ ] non-experimental status

## Risks & open decisions

1. **Phase 0 breaking changes**: unknown until attempted. Timebox the audit;
   the API surface table above is the checklist.
2. **`details` payloads** (`ToolExecutionPayload.details`) remain `unknown` at
   the type level and pass through unvalidated — unchanged from today, out of
   scope.
3. **Image data on the wire**: `AgentMessage` includes image `data`; web
   currently renders `ImageBlock` as type-only. Decide: render images, or
   strip `data` at the server boundary to save bandwidth.
4. **Rollback**: each phase is independently revertible; Phase 3 is the only
   behavior change and is gated behind reducer readiness.
