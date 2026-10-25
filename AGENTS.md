# AGENTS.md

Guidance for AI agents and contributors working on piflow.

## What this is

piflow is a browser GUI for the [pi coding agent](https://github.com/earendil-works/pi-coding-agent). It provides multi-session management, streaming chat with tool-call cards, steering control, and a Flow canvas for coordinating multiple independent pi sessions in one project.

## Repository layout

```
packages/
├── server/          # Node.js backend (runs via tsx, no build step for dev)
│   └── src/
│       ├── app.ts      # Fastify app: plugins, then routes
│       ├── plugins/    # Support plugins (auth)
│       ├── routes/     # Route plugins
│       ├── server/     # Config, static files, SSE
│       ├── sessions/   # pi session store
│       ├── flow/       # Flow canvas domain: store, tools
│       ├── usage/      # Provider quota adapters
│       ├── test/       # Mirrors the folders above
│       └── index.ts    # Listen and signals
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
- **Tests**: the server keeps them in `packages/server/src/test`, mirroring `plugins/`, `routes/`, and the domain folders. The web package keeps `foo.ts` beside `foo.test.ts`.
- **Component style**: `components/Name/index.tsx` + `styles.module.css`.
- **Protocol changes**: edit `packages/protocol/src/index.ts`; server and web consume it via `@piflow/protocol`.
- **Product scope**: [docs/PRD.md](docs/PRD.md) defines goals and explicit non-goals (piflow does not replace IDE, terminal, or Git hosting).

## Key entry points

| Concern | File |
|---|---|
| Server bootstrap | `packages/server/src/index.ts` |
| HTTP app | `packages/server/src/app.ts` registers `plugins/` then `routes/` |
| Session lifecycle | `packages/server/src/sessions/index.ts` |
| Flow agent tools | `packages/server/src/flow/tools.ts` |
| Flow persistence | `packages/server/src/flow/store.ts` |
| Frontend event projection | `packages/web/src/session/reducer.ts` |
| SSE transport | `packages/web/src/session/transport.ts` |

## Non-negotiables

- Loopback-first security: token auth, HttpOnly SameSite=Strict cookie, same-origin checks. Do not weaken these without a documented decision.
- Flow topology is user-owned: agents can never create/remove edges themselves.
- Markdown rendering must stay behind `rehype-sanitize`.
