# Agent Runtime and Multi-Agent Coordination Research

**Status:** Research note
**Last updated:** 2026-08-14
**Scope:** Lessons from tmux, herdr, and DeepSeek Harness for piflow

## 1. Research Question

piflow needs to support several long-running pi sessions inside one project without turning parallel work into more cognitive overhead. This research asks how adjacent products handle:

- persistent runtime ownership and reconnection
- multi-Agent status and human attention
- Agent-to-Agent communication
- durable event history and context provenance
- recovery after interrupted work

The goal is not to copy another runtime. piflow remains a local-first GUI for pi, and pi remains the source of Agent execution, conversation history, tools, models, and lifecycle semantics.

## 2. piflow Constraints

Any borrowed design must preserve the current Flow model:

- A Flow node is one independent pi session.
- Nodes are peers, not parent and child.
- Connections are symmetric capability boundaries created only by the user.
- A connection permits discovery, targeted retrieval, and explicit messages; it does not copy full context or execute automatically.
- Pi session files remain canonical for conversations.
- piflow stores only its own topology, routing, presentation, and bounded collaboration metadata.
- The focused Agent GUI remains the primary workflow. Flow exists to preserve the developer's train of thought, not to maximize Agent concurrency.

## 3. Comparison

| System | Primary abstraction | Runtime owner | Communication model | Attention model | Durable history |
| --- | --- | --- | --- | --- | --- |
| tmux | session, window, pane | tmux server | terminal input and output through commands or control mode | activity, bell, silence, status line | process state survives detach, but tmux is not an Agent event store |
| herdr | workspace and Agent terminal | background herdr server | Agents can create panes, prompt another Agent, inspect panes, and wait for status | `working`, `blocked`, `idle`, and completion-oriented navigation | terminals and layouts persist independently of clients |
| DeepSeek Harness | plugin-composed Agent session | Harness runtime | typed tools, inbox messages, sub-Agent follow-ups, reports, and events | live Agent status plus durable lifecycle events | append-only typed session event log |
| piflow | project-scoped peer session graph | pi runtime behind the piflow server | authorized `search`, `read`, and `send` across user-created connections | currently limited; intended to prioritize work requiring judgment | pi owns conversations; Flow owns topology and bounded message metadata |

The systems solve different layers. tmux supplies durable process primitives, herdr makes Agent terminals operable at scale, and DeepSeek Harness makes model-visible execution reconstructable. piflow's distinct responsibility is project-scoped attention and knowledge flow across independent pi sessions.

## 4. tmux

### 4.1 Runtime Model

tmux separates ownership from presentation:

- One server manages sessions, windows, panes, and their child processes.
- A client attaches to a session only to display and control it.
- Detaching or losing an SSH connection does not stop the session.
- Sessions, windows, and panes receive stable lifetime IDs.
- Clients and the server communicate through a Unix socket.

This is the important design, not terminal tiling. A UI connection is disposable; the runtime is authoritative and outlives it.

tmux itself does not guarantee continuation across a machine restart. Its native guarantee is survival across client detachment and connection loss. Restart restoration requires another layer.

### 4.2 Control And Attention

tmux control mode exposes a machine-readable protocol with notifications such as pane output, session changes, window creation, and layout changes. Its format variables and monitoring options expose activity, bell, and silence state. This lets a client build a projection without pretending to own the underlying processes.

For piflow, the relevant lessons are:

- browser connection lifetime must not define Agent lifetime
- session identity must remain stable across reconnection
- the server should expose authoritative structured state, not terminal-text heuristics
- reconnect should replace stale projections from an authoritative snapshot
- background activity and attention signals should be separate from raw output streaming

## 5. herdr

### 5.1 Product Model

herdr is an Agent-oriented terminal runtime. A background server owns real terminals so Agent CLIs can continue when no client is attached. It works with existing coding Agent CLIs rather than replacing their harnesses.

Its strongest product idea is not pane management. It is answering:

> Which Agent needs the user now?

herdr reads pane state and classifies Agents as `working`, `blocked`, or `idle`. Users do not need to inspect every terminal to find the one waiting for a decision.

### 5.2 Multi-Agent Message Flow

herdr does support multi-Agent coordination. Its CLI and socket API allow Agents to:

- create panes and start other Agent CLIs
- send prompts to another Agent's terminal
- inspect terminal state and output
- wait until another Agent is genuinely blocked before continuing

This produces a practical message flow:

```text
Agent A
  -> starts Agent B in a terminal
  -> sends B a prompt
  -> waits for B to stop or require input
  -> reads or requests B's result
```

This is terminal-level coordination, not a semantic knowledge protocol. The terminal is the address, prompt injection is the transport, and pane output is the observable result. The public product material does not describe a user-authored peer permission graph, targeted transcript retrieval, or durable provenance for exactly which retrieved context entered another model request.

### 5.3 Lessons For piflow

piflow should borrow herdr's attention routing while retaining stronger collaboration semantics:

- Derive session state from structured pi events rather than terminal output.
- Prefer actionable states such as `working`, `needs_input`, `review_ready`, `failed`, and `idle`.
- Make sessions requiring human judgment more prominent than sessions merely producing output.
- Allow the user to open the relevant focused conversation directly from the project overview.
- Keep Agent-to-Agent communication explicit and auditable through Flow tools.

piflow should not make terminal panes its product model. A pi session, its context boundary, and its authorized peers contain more useful product meaning than a terminal process.

## 6. DeepSeek Harness

### 6.1 Plugin Architecture

DeepSeek Harness is a developer-preview Agent runtime built on Cordis. Models, tools, skills, sessions, storage, sandboxing, scheduling, the Agent loop, and UI are plugins composed through services and typed events.

This makes capabilities replaceable through configuration, but adopting an equivalent framework in piflow would be premature. piflow has one required Agent runtime and few demonstrated provider replacement needs. The useful lesson is to keep ownership boundaries explicit, not to make every module a plugin.

### 6.2 Append-Only Session Events

The most relevant Harness rule is:

> Anything visible to the model must be reconstructable from the session log.

Its append-only log records typed events for turn and step boundaries, user and injected messages, assistant chunks and completed messages, tool calls and results, request headers, and plugin-defined extensions. The model history is derived from the event log rather than stored as a separate mutable transcript.

The same stream supports:

- request reconstruction
- recovery and resume
- fork lineage
- compaction projections
- transcripts and replay
- retrieval
- the Trajectory UI

Storage is a separate capability from the in-memory event model. The supplied persistence implementations write either append-only JSONL artifacts or SQLite rows with equivalent event fields.

### 6.3 Recovery

Harness preserves a durably written turn that was interrupted by a crash. On cold load, it appends a synthetic interrupted ending rather than deleting the completed prefix. This distinguishes interruption from successful completion without pretending execution continued.

That distinction is useful for piflow. It should document separate guarantees for:

- browser disconnection while the server remains alive
- piflow server restart during an Agent turn
- machine restart
- resuming a persisted but inactive pi session

Only states actually supported by pi should be presented as resumable. An interrupted turn must not appear successful or silently continue from an invented state.

### 6.4 Sub-Agent Communication

Harness supports one-shot and continuable child Agents. Continuable children have durable sessions, a single FIFO inbox, follow-up messages, interruption, cold resume, explicit reports to a parent, and runtime settlement notices.

The mechanism is informative, but its authority model is not suitable for Flow:

- Harness records a durable direct parent.
- Follow-up and interrupt authority follows that lineage.
- Children report to their parent.
- A provider may seed a child with parent history.

Flow deliberately uses peer sessions, symmetric user-controlled connections, and no automatic history inheritance. piflow can borrow durable delivery, one ordered inbox, explicit attribution, and settlement notices without borrowing parent-child topology.

## 7. Combined Lessons

### 7.1 Separate Runtime, Projection, And Topology

The three products reinforce a useful separation:

1. **Runtime facts:** pi session lifecycle, model requests, tool execution, queue state, and errors.
2. **UI projection:** the current chat, node status, attention list, and activity animation.
3. **Flow topology:** user-created peer connections and their authorization effects.

The browser must be able to discard and rebuild its projection without changing the runtime or topology.

### 7.2 Treat Attention As A Product Primitive

Raw streaming activity is not enough. A session status should help the user decide whether to wait, intervene, or review.

A practical piflow attention projection is:

| State | Meaning | UI priority |
| --- | --- | --- |
| `working` | Agent is thinking, responding, or executing a tool | quiet |
| `needs_input` | Agent cannot continue without a user decision or permission | highest |
| `review_ready` | Agent completed work that requires inspection | high |
| `failed` | Provider, tool, protocol, or runtime failure requires action | highest |
| `idle` | No active work and no pending user action | quietest |

This projection should be derived from pi's structured lifecycle. It should not replace the more detailed states shown inside focused chat.

### 7.3 Make Cross-Session Knowledge Traceable

The current `FlowMessageRecord` is enough to animate recent directional activity, but it is not a complete provenance model. A future Flow activity ledger should be able to represent piflow-owned facts such as:

- a connection was created or removed
- a peer directory changed and was injected
- an Agent searched a connected peer
- an Agent read an exact message range
- a Flow message was sent, queued, delivered, or failed

The ledger should reference canonical pi session content rather than duplicate full transcripts. Search excerpts, complete prompts, reasoning, and tool output should remain in pi sessions unless piflow itself owns the data.

The first UI projection of this ledger should be a restrained activity or Trajectory view answering:

- what crossed this connection
- which session initiated it
- what source material was consulted
- whether delivery reached the target session
- which operations failed

### 7.4 Preserve User Control

Neither herdr-style Agent spawning nor Harness-style parent orchestration should allow a Flow Agent to expand its own authority. Agents may act through existing connections, but only users create or remove those connections.

Automatic routing, graph expansion, and complete-context inheritance would undermine Flow's purpose of limiting context corruption.

## 8. Recommended Sequence

### Near Term: Attention Fidelity

1. Establish a server-authoritative status registry for active sessions.
2. Project the five attention states from structured pi events.
3. Surface `needs_input`, `failed`, and `review_ready` across chat and Flow.
4. Verify that browser refresh and reconnect do not change active Agent execution.

This is the highest-value lesson from herdr and directly improves the base Agent GUI.

### Next: Flow Activity Provenance

1. Define the smallest append-only vocabulary for piflow-owned collaboration facts.
2. Add monotonic ordering and stable references to sessions, nodes, connections, and canonical pi messages where available.
3. Replace transient polling-only activity with a recoverable projection.
4. Add a compact per-node or per-connection Trajectory view.

This should extend the current Flow store rather than introduce a general event framework.

### Later: Recovery Contracts

1. Specify behavior for disconnect, server restart, process crash, and machine restart.
2. Mark interrupted work explicitly when pi cannot resume an in-flight turn.
3. Restore inactive sessions without implying that their previous process is still running.
4. Add cursor-based event recovery only when authoritative snapshot replacement no longer meets measured needs.

### Deferred: Plugin Boundaries

Keep pi responsible for tool execution and Agent lifecycle. Move Flow tool registration and model-visible directory injection into a pi extension only when that integration removes duplicated dispatch logic and can still call piflow's local Flow data and authorization services.

Do not build a general plugin kernel until there are multiple real implementations that need replacement.

## 9. What Not To Copy

- Do not turn piflow into a terminal multiplexer.
- Do not infer semantic Agent state from rendered terminal text when pi exposes structured events.
- Do not model Flow sessions as parent and child.
- Do not seed peers with complete upstream history.
- Do not let Agents create their own authorization edges.
- Do not store a second copy of complete pi transcripts in a Flow event log.
- Do not expose or duplicate hidden model reasoning merely to imitate a Trajectory view.
- Do not adopt an everything-is-a-plugin architecture before concrete replacement needs exist.
- Do not encourage maximum parallelism; optimize for minimum human context switching.

## 10. Evaluation Questions

The next implementation work should be evaluated against observable user outcomes:

- Can the user identify the session requiring attention within five seconds?
- Can the user tell whether a background session is working, waiting, ready for review, or failed without opening it?
- After reconnecting, does the UI recover authoritative state without duplicate activity?
- Can the user determine why one peer knows information from another peer?
- Can the user inspect exactly which Flow operations crossed a connection without reading both complete transcripts?
- Does running several sessions reduce application and project switching, or merely create more items to monitor?

## 11. Sources

- [tmux manual](https://man.openbsd.org/tmux)
- [herdr website](https://herdr.dev/)
- [herdr repository](https://github.com/herdrdev/herdr)
- [DeepSeek Harness product preview](https://deepseek.com/harness/)
- [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness)
- [DeepSeek Harness architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [DeepSeek Harness session model](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md)
- [DeepSeek Harness persistence](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/persistence.md)
- [DeepSeek Harness sub-Agent model](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/subagent.md)

