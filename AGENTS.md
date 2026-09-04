# AGENTS.md

Guidance for AI agents and contributors working on piflow.

## What this is

piflow is a browser GUI for the [pi coding agent](https://github.com/earendil-works/pi-coding-agent). It provides multi-session management, streaming chat with tool-call cards, steering control, and a Flow canvas for coordinating multiple independent pi sessions in one project.

## Repository layout

```
packages/
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
├── cli/             # (planned) CLI + daemon
├── builtin-extensions/  # (planned) built-in pi extensions
└── protocol/        # @piflow/protocol — shared TS types (ServerMessage, etc.)

docs/                # Public product requirements
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
- **Protocol changes**: edit `packages/protocol/src/index.ts`; server and web consume it via `@piflow/protocol`.
- **Product scope**: [docs/PRD.md](docs/PRD.md) defines goals and explicit non-goals (piflow does not replace IDE, terminal, or Git hosting).

## Key entry points

| Concern | File |
|---|---|
| Server bootstrap | `packages/server/src/index.ts` |
| HTTP routes + auth | `packages/server/src/core/routes.ts` |
| Session lifecycle | `packages/server/src/core/sessions.ts` |
| Flow agent tools | `packages/server/src/flow/tools.ts` |
| Flow persistence | `packages/server/src/flow/store.ts` |
| Frontend event projection | `packages/web/src/session/reducer.ts` |
| SSE transport | `packages/web/src/session/transport.ts` |

## Non-negotiables

- Loopback-first security: token auth, HttpOnly SameSite=Strict cookie, same-origin checks. Do not weaken these without a documented decision.
- Flow topology is user-owned: agents can never create/remove edges themselves.
- Markdown rendering must stay behind `rehype-sanitize`.
