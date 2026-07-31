# piflow Product Requirements Document

**Status:** Draft v0.1

**Date:** 2026-07-29

**Product scope:** Local-first browser GUI for the pi coding agent

**Primary audience:** Individual developers

## 1. Executive Summary

### Problem Statement

Pi is effective in the terminal, but long-running agent work spreads decisions, progress, tool output, and project context across terminal scrollback, session lists, editors, and browser tabs. Managing multiple sessions within one project adds mental context switching precisely when the user is trying to preserve a flow state.

### Proposed Solution

piflow will first become an exceptionally reliable and complete browser GUI for pi: session continuity, streaming interaction, tool visibility, review, model controls, mobile access, and every human decision must work without leaving the interface. Once that foundation meets explicit quality gates, piflow will add a project-scoped spatial canvas that organizes sessions, context, artifacts, and decisions without replacing the focused chat experience.

### Product Principles

- Preserve thought continuity: relevant information and decisions should appear where the user is already working.
- Reliability before novelty: the canvas cannot compensate for an incomplete or inconsistent Agent GUI.
- Quiet by default: only failures, blocked work, and review-ready work should demand attention.
- Progressive disclosure: the focused conversation is primary; details and project topology appear when useful.
- Local-first and pi-native: use pi sessions, models, tools, and credentials rather than introducing another agent runtime.
- One project, one mental workspace: optimize for an individual working deeply inside a project, not for managing an organization.

### Success Criteria

- Automated protocol replay completes 1,000 mixed lifecycle events with zero lost, duplicated, or incorrectly ordered user-visible messages.
- Opening a local session containing up to 500 messages reaches an interactive chat state within 1 second at p95 on the reference development machine.
- Connection loss, provider errors, tool failures, context compaction, queued input, and Agent completion become visible in the UI within 500 ms of the server receiving the corresponding event.
- All Foundation workflows in Stories 1-8 can be completed without opening the terminal in a release acceptance run.
- At least 80% of sessions in a five-user dogfood study complete without switching applications to inspect Agent state, retrieve routine data, or answer an Agent decision.
- Mobile acceptance passes at 390 px width with no inaccessible controls, horizontal page scrolling, or loss of essential session functionality.

## 2. User Experience & Functionality

### User Personas

#### Primary: Flow-Focused Pi Developer

An individual developer who uses pi for implementation, investigation, refactoring, and review. They want to understand and direct the Agent while keeping project context in one place.

#### Secondary: Parallel Session Power User

An experienced pi user who runs several sessions inside the same project while an Agent is thinking or coding. They need clear status, isolation, and handoff without repeatedly reconstructing context.

#### Secondary: Remote Browser User

An individual developer who checks progress, answers a question, steers work, or reviews output from a phone or another trusted device over a private network.

### Experience Hierarchy

1. Stable connection and correct session state.
2. Complete representation of Agent behavior and errors.
3. Efficient input, session navigation, and review.
4. Responsive mobile and trusted remote access.
5. Refined visual design and motion.
6. Spatial canvas and multi-session project overview.

### Core User Flow

1. The user opens piflow and immediately sees recent pi sessions grouped by project.
2. The previous session is restored, or the user opens or creates a session.
3. The user sends a prompt, optionally with supported attachments and model settings.
4. Streaming thinking, text, tool activity, queue state, usage, and errors update in place.
5. The user can steer, enqueue follow-up work, answer a decision, or abort without leaving the conversation.
6. The user reviews changed files, diffs, test output, and the Agent's conclusion in the same workspace.
7. The user resumes, forks, or switches sessions without losing draft text or reading position.
8. After the foundation quality gate, the user may switch to a project canvas to inspect and organize related work, then return to focused chat.

### User Stories and Acceptance Criteria

#### Story 1: Resume Work Reliably

As a developer, I want piflow to restore the correct session and reading position so that reopening the browser does not interrupt my train of thought.

**Acceptance Criteria**

- The last active session is restored after refresh when it still exists.
- Each session retains its own draft and scroll position locally.
- Opening, creating, and switching sessions cannot leave the UI waiting indefinitely; failures produce an actionable error within 10 seconds.
- Session state is refreshed when the user enters a session, including changes made by another pi client.
- Reconnecting after a WebSocket interruption restores authoritative state without duplicating messages or tool results.
- Sessions can be searched by title, first message, project path, and recent activity.

#### Story 2: Follow Agent Activity Without Guessing

As a developer, I want every meaningful Agent state represented clearly so that I know whether to wait, intervene, or review.

**Acceptance Criteria**

- The UI distinguishes idle, thinking, responding, using a tool, compacting, waiting for input, aborted, failed, and complete states.
- Thinking and assistant text stream incrementally without replacing completed content.
- Tool calls expose tool name, relevant arguments, progress, result, duration when available, and failure state.
- Provider, authentication, quota, network, and tool errors appear inside the affected session and remain visible until superseded or dismissed.
- Background sessions show only quiet status by default; waiting, failed, and review-ready states receive stronger emphasis.
- No successful-looking terminal state is shown while an unresolved error exists.

#### Story 3: Direct the Agent Efficiently

As a developer, I want predictable composer and queue behavior so that I can redirect work without interrupting myself.

**Acceptance Criteria**

- Enter sends, Shift+Enter inserts a newline, and IME composition never submits prematurely.
- The composer supports pasted text and pi-supported image attachments; unsupported files are rejected before sending with a reason.
- While the Agent runs, users can explicitly choose steering or follow-up delivery semantics.
- Queued messages remain visible, can be removed before delivery, and return to the composer after abort when supported by pi.
- Abort provides immediate feedback and settles into an authoritative final state.
- Drafts survive session switches and accidental refreshes.
- Sending is idempotent from the user's perspective: retries cannot silently create duplicate prompts.

#### Story 4: Control Model, Thinking, Context, and Quota

As a developer, I want model controls and resource limits visible near the composer so that I can make decisions before work is interrupted.

**Acceptance Criteria**

- Available models and supported thinking levels come from the active pi runtime.
- The current model and thinking level update immediately after a successful change and show an error after rejection.
- Context usage updates during and after Agent turns, with neutral, warning, and critical thresholds.
- Provider quota refreshes after completed turns and reports reset windows when supported.
- Missing provider usage support remains visually quiet and never blocks prompting.
- Context compaction is visible and the resulting context value replaces stale data.

#### Story 5: Inspect and Review Work In Place

As a developer, I want outputs converted into reviewable artifacts so that I do not have to reconstruct work from chat history.

**Acceptance Criteria**

- File edits render as readable diffs with changed-file navigation.
- Tool output remains collapsible but searchable and copyable.
- Paths open the relevant local artifact through a supported, explicit action; unavailable integrations degrade to copying the path.
- Test commands expose status, failures, and a concise summary without hiding raw output.
- The final Agent response remains visually connected to the tool activity that produced it.
- Review comments can be sent back to the active session with referenced file and line context when the underlying data is available.

#### Story 6: Manage Pi Sessions Completely

As a pi user, I want essential session operations in the browser so that normal work does not require returning to the terminal UI.

**Acceptance Criteria**

- Users can create, open, rename, and resume pi sessions.
- Users can fork or branch from an existing session point when supported by the pi SDK.
- Session tree navigation is available before canvas development begins; unsupported SDK behavior is documented rather than emulated by rewriting session files.
- Session list metadata updates after prompts, renames, and external changes.
- Destructive session actions require explicit confirmation and never modify unrelated pi sessions.
- piflow and the terminal client continue to read the same canonical pi session data.

#### Story 7: Answer Decisions Without Context Switching

As a developer, I want Agent questions and permission requests rendered as first-class UI so that necessary human judgment does not disappear in a transcript.

**Acceptance Criteria**

- Structured Agent questions appear as focused controls with all options and supporting context.
- Permission requests identify the requested action, scope, and persistence of the decision.
- A pending decision is visible in both the active session and session list.
- Responding updates the existing turn rather than creating an unrelated user message when pi exposes a structured response API.
- Multiple pending decisions remain associated with their originating session and cannot be answered from the wrong session.

#### Story 8: Use piflow From a Trusted Mobile Device

As a developer, I want to monitor and steer pi from my phone so that short interventions do not require returning to my desk.

**Acceptance Criteria**

- Chat, session navigation, decisions, steering, follow-up, and abort remain usable at 390 px width.
- Touch targets are at least 44 by 44 CSS pixels for primary actions.
- The composer remains visible with the virtual keyboard open and respects safe-area insets.
- Remote binding requires an explicit high-entropy token and never defaults to a public interface.
- The documentation recommends an encrypted private network; piflow does not imply that plain HTTP over a LAN is encrypted.

#### Story 9: Understand Project Work Spatially

As a parallel session user, I want a project canvas that shows related sessions, context, artifacts, and decisions so that switching tasks does not require rebuilding the project state in my head.

**Acceptance Criteria**

- Canvas development starts only after every Foundation Gate in the roadmap passes.
- The canvas is scoped to one project and opens as an optional overview, never as a replacement for focused chat.
- V2 supports exactly four initial node types: Session, Context, Artifact, and Decision.
- Session nodes summarize goal, status, context usage, latest conclusion, and modified artifacts without embedding the full transcript.
- Users can select nodes as context for a new or existing pi session.
- Users can create a derived session from an existing node and retain a visible `derived from` relationship.
- Initial edges express `derived from`, `depends on`, `produced`, or `awaits decision`; edges do not execute Agents automatically.
- Failed, waiting, and review-ready nodes are discoverable without continuous animation or automatic camera movement.
- Canvas layout and viewport persist locally without modifying the user's repository by default.

### Non-Goals

- Team accounts, multiplayer editing, shared cloud workspaces, organizational permissions, or billing.
- A hosted pi runtime or storage of project code on a piflow service.
- Replacing the user's IDE, terminal, issue tracker, or Git hosting provider.
- Supporting non-pi agent harnesses in the initial product roadmap.
- Autonomous multi-Agent graphs, executable canvas edges, or visual prompt programming in V2.
- Multi-repository orchestration on one canvas in V2.
- A built-in public tunnel or a claim that token-authenticated HTTP is safe on an untrusted network.
- Reimplementing pi session semantics when the SDK does not expose a safe operation.

## 3. AI System Requirements

### Tool Requirements

- `@earendil-works/pi-coding-agent` remains the only Agent runtime and source of session, model, thinking, queue, compaction, and lifecycle semantics.
- The server subscribes to structured pi events rather than inferring state from rendered terminal output.
- Pi session files remain canonical; piflow-specific UI state is stored separately.
- Provider usage adapters are optional capabilities with strict typed results and explicit unsupported states.
- Artifact extraction uses structured tool results and Git data when available; it must not invent successful tests, changed files, or review status.
- Canvas context insertion must produce a visible context manifest before it is sent to pi.

### Evaluation Strategy

- Maintain deterministic protocol fixtures for complete turns, tool failures, aborts, compaction, queued messages, reconnects, and malformed input.
- Replay recorded, redacted pi event streams against the web state reducer and compare the resulting session projection to snapshots.
- Run compatibility tests against the minimum and current supported pi package versions; frontend and server builds themselves use one strict protocol version.
- Benchmark session opening with 100, 500, and 1,000-message fixtures, including large tool outputs.
- Run responsive acceptance at 390, 768, 1180, and 1440 CSS pixel widths.
- Conduct task-based dogfood evaluations for resume, steer, follow-up, abort, model change, error recovery, review, and mobile decision handling.
- Before V2 release, test whether users can identify the session requiring attention and reconstruct a task's origin and outputs from the canvas within 10 seconds.

## 4. Technical Specifications

### Architecture Overview

The current local-first architecture remains the baseline:

```text
Browser (Vue 3)
  ↕ authenticated WebSocket + HTTP
Node/TypeScript server
  ↕ pi SDK lifecycle and commands
Pi sessions, models, credentials, and tools
```

The server owns authoritative runtime sessions and serializes typed state and events. The browser maintains a projection optimized for rendering, but replaces it with authoritative state after opening or reconnecting. UI-only state such as drafts, scroll positions, panel preferences, and later canvas layout remains separate from pi session files.

For V2, canvas metadata will be stored under a piflow application-data directory, keyed by normalized project path. Repository-local export may be added later as an explicit user action.

### Required Components

- **Session Registry:** Opens, creates, refreshes, and disposes pi sessions with one authoritative key per session.
- **Protocol Boundary:** Parses every client message from `unknown`, validates required fields, limits payload size, and correlates request/response pairs by request ID.
- **Session Projection:** Converts lifecycle events into a deterministic browser state without duplicated messages or stale live content.
- **Interaction Adapter:** Maps composer, queue, structured decisions, permissions, abort, model, and thinking actions to pi SDK operations.
- **Artifact Projection:** Normalizes diffs, changed files, command results, tests, and references from structured Agent events.
- **Usage Registry:** Provides optional typed quota adapters with bounded caching and explicit refresh.
- **Canvas Store:** Introduced only in V2; persists schema-versioned nodes, edges, frames, and viewport independently of conversations.

### Data Contracts

- All cross-process messages use discriminated TypeScript unions with no `any`.
- Every command that expects a direct reply includes a request ID.
- State broadcasts and direct replies are distinct protocol concepts.
- The frontend and server are released as one unit and use one strict protocol version. Startup must fail clearly on incompatible assets rather than add legacy fallback behavior.
- Canvas documents include a schema version and deterministic migration path before V2 data is considered durable.
- Server payloads have explicit size limits; large artifacts use bounded summaries with on-demand detail retrieval.

### Integration Points

- Pi SDK for Agent runtime, session management, models, thinking levels, queues, compaction, and events.
- Pi session storage under the user's configured Agent directory.
- Pi credential storage through SDK-supported access; piflow does not expose raw credentials to the browser.
- Git command-line integration for diffs and worktree metadata is `TBD` pending an implementation design and threat review.
- Browser local storage for disposable per-device preferences; application-data files for durable piflow metadata.
- Tailscale or an equivalent user-managed private network for recommended remote access.

### Performance Requirements

- Stream rendering must batch high-frequency updates to at most one DOM commit per animation frame.
- The message list must remain responsive with 1,000 messages and large collapsed tool outputs; virtualization is required only after measurement demonstrates a frame-time regression.
- Initial JavaScript should exclude syntax languages and canvas code not required for the current route when bundle analysis shows material startup cost.
- Canvas interaction must maintain 50 fps at p95 while panning 100 lightweight nodes on the reference development machine.

### Security & Privacy

- Bind to loopback by default.
- Require a URL-safe token with at least 24 characters for non-loopback binding.
- Authenticate through an HttpOnly, SameSite cookie and enforce exact same-origin WebSocket connections.
- Never send credentials, full environment variables, or private key material to the browser.
- Treat rendered Markdown, tool output, paths, and model text as untrusted content; sanitize HTML and avoid executable links.
- Keep sessions, canvas metadata, drafts, and usage data local by default with no telemetry in the initial roadmap.
- Document that piflow can expose sensitive source code and command output to anyone with authorized browser access.

### Accessibility and Visual Quality

- All primary workflows must be keyboard accessible with visible focus states.
- Status cannot rely on color alone.
- Motion respects `prefers-reduced-motion` and avoids automatic camera movement.
- Text and interactive controls meet WCAG AA contrast targets.
- Desktop and mobile layouts preserve the same information hierarchy rather than hiding critical state on smaller screens.

## 5. Risks & Roadmap

### Phased Rollout

#### MVP: Agent GUI Foundation

- Deterministic session projection, reconnect recovery, request correlation, and visible errors.
- Reliable session open/create/restore, per-session draft and scroll persistence, and session search.
- Complete streaming text, thinking, tool activity, compaction, abort, and current steering behavior.
- Model, thinking, context, and supported provider quota controls.
- Responsive baseline and secured local/LAN operation.
- Automated event replay and large-session performance fixtures.

#### v1.1: Complete Focused Workflow

- Explicit steering and follow-up queue management.
- Supported image attachments and durable drafts.
- Structured Agent questions and permission requests.
- Session rename, fork, and tree navigation through supported pi APIs.
- First-class diff, changed-file, test-result, and review interactions.
- Performance and accessibility polish based on measured failures.

#### Foundation Gate

Canvas product implementation must not begin until both the MVP and v1.1 scope are complete and all conditions pass:

- Zero message loss or duplication in the 1,000-event replay suite.
- All Success Criteria pass in CI or a documented release acceptance environment.
- No Foundation workflow in Stories 1-8 requires terminal fallback because of missing GUI state or control.
- Mobile acceptance passes at 390 px.
- Session reconnect and external-change behavior have deterministic tests.
- Known provider and tool failures are visible and recoverable without refreshing the page.

Low-cost, throwaway canvas prototypes may be used for product discovery before the gate, but they must not introduce production dependencies or reshape the core architecture.

#### v2.0: Project Flow Canvas

- Optional one-project canvas with Session, Context, Artifact, and Decision nodes.
- Spatial grouping, search, minimap, restrained status, and local persistence.
- Derive sessions from nodes and attach selected node context to prompts.
- Semantic, non-executable relationships and focused chat navigation.
- Automatic artifact and decision projection only where structured source data exists.

#### Post-v2 Considerations

- Reusable project workflow templates.
- Opt-in canvas export into a repository.
- Worktree-aware frames if parallel isolation becomes a demonstrated need.
- Limited Agent-assisted canvas organization with preview and undo.
- Executable edges, multi-repository views, and collaboration remain separate product decisions, not assumed roadmap items.

### Technical Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Pi SDK lifecycle changes | Session state becomes incorrect across package upgrades | Pin supported versions, maintain event replay fixtures, and test minimum/current versions |
| Browser projection diverges from authoritative session state | Lost, duplicated, or stale messages | Deterministic reducer, request IDs, authoritative refresh on open/reconnect |
| Large transcripts and tool output degrade rendering | The core chat becomes less usable as sessions grow | Collapse raw output, benchmark fixtures, batch updates, add virtualization only when measured |
| Remote access exposes source code or command output | High privacy and security impact | Loopback default, explicit token, same-origin checks, private-network guidance |
| Provider quota APIs change or rate-limit clients | Misleading usage information | Optional adapters, short cache, explicit unsupported/error states, no prompting dependency |
| Canvas increases rather than reduces cognitive load | Product contradicts its flow-state goal | Four node types, quiet status, focused chat primary, usability time-to-orient metric |
| Feature breadth turns piflow into an IDE or project manager | Core Agent GUI remains unfinished | Foundation Gate, explicit non-goals, no production canvas work before P0 completion |
| Automatic artifact extraction is incomplete | Users trust inaccurate review state | Prefer structured data, label partial projections, retain raw source output |
| Local canvas metadata becomes corrupted | Spatial organization is lost | Schema versioning, atomic writes, backup of last valid document, recoverable reset |

### Product Risks

- Users may prefer a conventional session list over a canvas. The canvas must remain optional and prove faster orientation in usability tests.
- Parallel sessions can create more context switching rather than less. piflow should emphasize blocked and review-ready work, not encourage maximum concurrency.
- Competitors already offer broad infinite-canvas workspaces. piflow should differentiate through pi-native depth, low distraction, and a focused single-project workflow rather than feature count.
- Visual novelty may temporarily obscure missing basics. Release reviews must evaluate Foundation Gate metrics before visual roadmap work.
