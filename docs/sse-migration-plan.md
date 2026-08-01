# SSE Migration Plan

Date: 2026-08-01

## Context

`piflow` currently uses a single `WebSocket` connection for both commands and streamed Agent events.

Current responsibilities on that connection:

- request/response style actions such as opening sessions, creating sessions, listing directories, and listing models
- fire-and-forget commands such as `prompt`, `abort`, `set_model`, and `set_thinking`
- server-pushed events such as assistant streaming updates, tool execution updates, session state refreshes, usage updates, and errors

The product boundary in the current PRD is still a local-first, single-user Agent GUI rather than a collaborative realtime system. That makes the main data flow look like this:

1. The browser sends a command.
2. The server drives an Agent session.
3. The server streams state and events back to the browser.
4. The browser occasionally sends another command.

That shape is a better semantic fit for `HTTP commands + SSE events` than for a general-purpose bidirectional socket.

## Decision

Migrate from `WebSocket` to `HTTP + SSE`.

Scope of this decision:

- replace the transport layer
- keep the current in-memory session pool
- keep the current session event model
- keep the current frontend store and reducer shape in the first migration pass

Out of scope for the first pass:

- rewriting frontend state management
- changing session persistence
- redesigning message rendering
- introducing durable event replay or cursor-based recovery

## Why Migrate

### Benefits of SSE for This Product

- The transport matches the product model more closely: commands go up, events come down.
- The system becomes easier to reason about because commands and streamed state are separated.
- Deployment and proxy behavior are usually simpler because SSE stays inside ordinary HTTP semantics.
- Cookie auth and same-origin enforcement stay aligned with normal HTTP handling.
- Reconnect behavior is easier to implement without keeping a bidirectional socket protocol alive.

### What We Give Up

- A single transport for both commands and events.
- Native support for future features that require high-frequency bidirectional realtime state.
- Some protocol-level flexibility if the product later expands into collaborative or presence-heavy workflows.

### Why the Tradeoff Is Acceptable Now

The current PRD emphasizes:

- local-first behavior
- session continuity
- incremental streamed text and tool visibility
- reliable reconnection to authoritative state

Those requirements do not require a long-lived bidirectional channel. They are fully compatible with `POST/fetch` for commands and `SSE` for event flow.

## Target Architecture

### Command Channel

Use ordinary HTTP endpoints for explicit user actions and request/response reads.

Examples:

- `GET /api/hello`
- `GET /api/sessions`
- `GET /api/models`
- `GET /api/directories?path=...`
- `GET /api/usage?...`
- `POST /api/sessions/open`
- `POST /api/sessions/new`
- `POST /api/sessions/:key/prompt`
- `POST /api/sessions/:key/abort`
- `POST /api/sessions/:key/model`
- `POST /api/sessions/:key/thinking`

### Event Channel

Use `GET /api/events` as a single SSE stream for server-driven updates.

The first version should keep the same broadcast semantics as the current WebSocket implementation:

- session events
- state refreshes
- session list refreshes
- errors
- optional usage updates

### Session Runtime

Keep the existing in-memory managed session pool and subscription model:

- `pool: Map<string, Managed>`
- `session.subscribe(...)`

The transport changes, but the session runtime does not.

## API Mapping

Map current socket messages to HTTP routes as follows.

| Current message | New endpoint | Notes |
| --- | --- | --- |
| `list_sessions` | `GET /api/sessions` | plain query |
| `list_models` | `GET /api/models` | plain query |
| `open` | `POST /api/sessions/open` | returns full state |
| `new` | `POST /api/sessions/new` | returns full state |
| `list_directories` | `GET /api/directories?path=...` | plain query |
| `prompt` | `POST /api/sessions/:key/prompt` | returns `202 Accepted` |
| `set_model` | `POST /api/sessions/:key/model` | no streaming in response |
| `set_thinking` | `POST /api/sessions/:key/thinking` | no streaming in response |
| `get_usage` | `GET /api/usage?...` or `GET /api/sessions/:key/usage?...` | either shape is fine |
| `abort` | `POST /api/sessions/:key/abort` | fire-and-forget |

## SSE Message Format

Keep the current JSON message shapes where possible so the frontend `route()` logic can survive the migration with minimal change.

Recommended SSE envelope:

```text
id: 1284
event: state
data: {"type":"state","state":{...}}

```

Recommended event names:

- `hello`
- `sessions`
- `models`
- `state`
- `event`
- `usage`
- `error`
- `heartbeat`

The browser may route by SSE event name, by the JSON `type` field, or both. Keeping the JSON `type` field is the simplest compatibility path.

## Server Migration Plan

### Phase 1: Separate Business Logic from Transport

Refactor the current WebSocket handler so business operations no longer depend on `ws.send(...)`.

Target split:

- query handlers that return JSON responses
- command handlers that perform side effects and optionally trigger later events

This makes the same logic reusable from HTTP routes.

### Phase 2: Introduce an SSE Client Registry

Replace the current socket client set with an SSE client registry.

Suggested server-side shape:

```ts
interface SseClient {
  id: string
  send: (event: string, data: unknown) => void
  close: () => void
}
```

The current `broadcast()` logic should write SSE chunks rather than calling `ws.send(...)`.

### Phase 3: Add `GET /api/events`

This route should:

- validate the existing auth cookie
- set SSE headers
- register the client
- immediately send initial sync data
- emit heartbeats every 15-30 seconds
- remove the client on disconnect

Suggested headers:

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`

### Phase 4: Add HTTP Command Endpoints

Create explicit HTTP routes for current socket messages.

Important rule:

- `prompt` must remain asynchronous
- the HTTP response should return quickly
- actual agent progress must continue to arrive over SSE

Do not turn `prompt` into a long-lived streaming POST response.

### Phase 5: Keep Session Subscriptions Intact

Do not change the current `session.subscribe(...)` model in the first migration pass.

Only replace the delivery mechanism:

- before: broadcast to all WebSocket clients
- after: broadcast to all SSE clients

## Frontend Migration Plan

### Phase 1: Introduce an HTTP API Layer

Create an `api.ts` module that wraps current command and query operations:

- `fetchSessions()`
- `fetchModels()`
- `openSession(path)`
- `newSession()`
- `requestDirectories(path)`
- `sendPrompt(key, text)`
- `abort(key)`
- `setModel(key, provider, modelId)`
- `setThinking(key, level)`
- `requestUsage(...)`

### Phase 2: Replace the WebSocket Client with EventSource

Replace the socket connection setup with an `EventSource` connection to `/api/events`.

Keep the current auth bootstrap flow. After auth succeeds:

- open the SSE stream
- parse JSON from incoming `data`
- feed those messages into the existing `route()` function

### Phase 3: Remove RequestTracker Coupling for Queries

`RequestTracker` currently exists because the WebSocket layer simulates request/response behavior.

After migration:

- `openSession()` should await an HTTP response directly
- `newSession()` should await an HTTP response directly
- `requestDirectories()` should await an HTTP response directly

That means `RequestTracker` can likely be removed or reduced substantially.

### Phase 4: Preserve Store and Event Reducers

Keep these pieces stable in the first pass:

- `store`
- `SessionView`
- `route()`
- `handleEvent()`

The transport should change without forcing a frontend architecture rewrite.

## Reconnection Strategy

The first SSE version does not need durable replay or `Last-Event-ID`.

Instead, on reconnect:

1. Re-establish the SSE stream.
2. Re-send `sessions`.
3. Re-send authoritative `state` for the active session.
4. Let the frontend overwrite drifted local `live` or `toolResults` state from that authoritative snapshot.

This matches the product requirement that reconnect restores authoritative state without duplicates, but avoids introducing event log infrastructure in the first pass.

## Rollout Plan

### Step 1: Dual Stack

Add SSE and HTTP routes while keeping the current WebSocket path alive.

This allows:

- side-by-side verification
- low-risk migration
- rollback without transport rework

### Step 2: Frontend Transport Flag

Add a transport switch such as:

- `PIFLOW_TRANSPORT=ws`
- `PIFLOW_TRANSPORT=sse`

Default to `ws` initially, then run regression checks using `sse`.

### Step 3: Regression Coverage

Validate these flows on the SSE path:

- open existing session
- create new session
- send prompt
- stream assistant output
- stream tool lifecycle updates
- steer while streaming
- abort
- set model
- set thinking
- refresh usage
- reconnect and recover authoritative state

### Step 4: Remove WebSocket

After the SSE path is stable:

- delete `/ws`
- remove `ws` server dependencies
- remove origin checks that only exist for WebSocket upgrade handling
- remove request/response emulation paths that only existed for sockets

## Risks

### Risk: Reconnect Edge Cases

Because the first version relies on authoritative state refresh rather than durable event replay, reconnect handling must be tested carefully around:

- assistant streaming
- tool updates
- compaction boundaries
- queued steering

### Risk: Over-Broadcasting

The first SSE version should preserve current broadcast behavior for simplicity, but that also preserves current noise and unnecessary cross-session updates. This is acceptable for the first pass, but not necessarily the best long-term shape.

### Risk: Migration Scope Creep

The easiest way to derail this work is to combine protocol migration with:

- frontend rendering changes
- store redesign
- message model changes
- replay infrastructure

Those should remain separate efforts.

## Recommended First Implementation

Build the smallest version that proves the architectural change:

1. Keep the current managed session pool.
2. Keep the current frontend store and event reducers.
3. Add HTTP endpoints for commands and reads.
4. Add one global SSE stream.
5. Run the app behind a transport flag.
6. Remove WebSocket only after the SSE path is stable.

This is the fastest path to verifying whether `SSE` is the right protocol for `piflow`'s current business shape without paying for a full frontend rewrite.
