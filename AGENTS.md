# AGENTS.md

Guidance for AI agents and contributors working on piflow.

## What this is

piflow is a browser GUI for the [pi coding agent](https://github.com/earendil-works/pi-coding-agent). It provides multi-session management, streaming chat with tool-call cards, steering control, and a Flow canvas for coordinating multiple independent pi sessions in one project.

## Repository layout

```
apps/
├── server/          # Node.js backend (runs via tsx, no build step for dev)
│   └── src/
│       ├── core/    # HTTP/SSE server: config, http, routes, sessions, sse
│       ├── flow/    # Flow canvas domain: store (persistence), tools (agent tools)
│       ├── usage/   # Provider quota adapters
│       └── index.ts # Entry point
├── web/             # React 19 + Vite frontend
│   └── src/
│       ├── components/  # Flat component folders (index.tsx + styles.module.css)
│       ├── session/     # Global state: reducer, store, transport, api
│       ├── flow/        # Flow canvas HTTP client
│       └── markdown/    # Streaming markdown pipeline (shiki, sanitize)
└── cli/             # (planned) CLI + daemon

shared/
└── protocol/        # @piflow/protocol — shared TS types (ServerMessage, etc.)

docs/                # PRD, Flow technical design, dogfood plans
```

## Commands

```bash
pnpm install        # install all workspaces
pnpm dev            # run server + web in dev mode
pnpm lint           # eslint + stylelint
pnpm typecheck      # tsc --noEmit across workspaces
pnpm test           # node:test across workspaces
pnpm build          # production build (web dist + server tsc)
```

## Conventions

- **Language**: TypeScript, ES modules, `node:test` for tests.
- **Tests colocated**: `foo.ts` ↔ `foo.test.ts` in the same directory.
- **Component style**: `components/Name/index.tsx` + `styles.module.css`.
- **Protocol changes**: edit `shared/protocol/src/index.ts`; both apps consume it.
- **Flow domain docs**: [docs/flow-technical-design.md](docs/flow-technical-design.md) is authoritative for Flow semantics (peer nodes, user-owned topology, explicit communication).
- **Product scope**: [docs/PRD.md](docs/PRD.md) defines goals and explicit non-goals (piflow does not replace IDE, terminal, or Git hosting).

## Key entry points

| Concern | File |
|---|---|
| Server bootstrap | `apps/server/src/index.ts` |
| HTTP routes + auth | `apps/server/src/core/routes.ts` |
| Session lifecycle | `apps/server/src/core/sessions.ts` |
| Flow agent tools | `apps/server/src/flow/tools.ts` |
| Flow persistence | `apps/server/src/flow/store.ts` |
| Frontend event projection | `apps/web/src/session/reducer.ts` |
| SSE transport | `apps/web/src/session/transport.ts` |

## Non-negotiables

- Loopback-first security: token auth, HttpOnly SameSite=Strict cookie, same-origin checks. Do not weaken these without a documented decision.
- Flow topology is user-owned: agents can never create/remove edges themselves.
- Markdown rendering must stay behind `rehype-sanitize`.
