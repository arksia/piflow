# AGENTS.md

Guidance for AI agents and contributors working on piflow.

## What this is

piflow is a browser GUI for the [pi coding agent](https://github.com/earendil-works/pi-coding-agent). It provides multi-session management, streaming chat with tool-call cards, steering control, and a Flow canvas for coordinating multiple independent pi sessions in one project.

## Development stage and architecture

- **piflow is currently in the MVP stage.** Optimize for the best coherent target architecture and minimize technical debt; preserving the current implementation is not a goal in itself.
- Breaking refactors are allowed whenever necessary, including replacing existing architecture, removing obsolete code, and changing internal interfaces, protocols, or schemas. Prefer a clean replacement over compatibility layers or temporary abstractions that preserve an unsuitable design.
- Keep the solution proportional to confirmed requirements. Explain material trade-offs, update affected documentation and tests, and verify the resulting behavior.
- During the architecture rethink, evaluate replacements against the target architecture rather than the current implementation. Existing names, package boundaries, storage formats, and execution paths are not constraints; retain them only when they remain the best fit. Preserve user data and unrelated work when replacing them.
- This permits architectural and code changes, not unrequested deletion of user data or unrelated local work. Continue to respect the non-negotiables below.

## Domain language

- For concepts shared with pi, use the terminology and semantics of the specific pi runtime/version being integrated. For other shared concepts, prefer established terminology from mainstream harness projects over inventing piflow-specific names.
- Record piflow-specific meanings and distinctions in `GLOSSARY.md`. Do not narrow general terms such as Message to a single source or conflate Session, Run, Turn, model request, and transport attempt.
- When upstream projects use the same word differently, document the mapping and its source. Do not claim a cross-project standard or silently change pi event semantics. Keep proposed terminology changes distinct from completed implementation migrations.

## UI design discussions

- When discussing a page, interaction, or visual module, include a screenshot of the corresponding current UI so the user can quickly locate it. Identify the page and entry point, and annotate the relevant area when useful.
- Use actual screenshots for current behavior; label mockups and proposed designs explicitly. If the page cannot be captured, state that limitation rather than presenting an invented screenshot as the current UI.

## Repository layout

```
apps/
├── server/          # Node.js HTTP host and current pi session runtime
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
packages/
└── protocol/        # @piflow/protocol — browser/HTTP wire contracts; built to dist

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
- **Tests**: the server keeps them in `apps/server/src/test`, mirroring `plugins/`, `routes/`, and the domain folders. The web package keeps `foo.ts` beside `foo.test.ts`.
- **Component style**: `components/Name/index.tsx` + `styles.module.css`.
- **Protocol changes**: edit `packages/protocol/src/index.ts`; server and web consume it via `@piflow/protocol`.
- **Product scope**: [docs/PRD.md](docs/PRD.md) defines goals and explicit non-goals (piflow does not replace IDE, terminal, or Git hosting).

## Key entry points

| Concern | File |
|---|---|
| Server bootstrap | `apps/server/src/index.ts` |
| HTTP app | `apps/server/src/app.ts` registers `plugins/` then `routes/` |
| Session lifecycle | `apps/server/src/sessions/index.ts` |
| Flow agent tools | `apps/server/src/flow/tools.ts` |
| Flow persistence | `apps/server/src/flow/store.ts` |
| Frontend event projection | `apps/web/src/session/reducer.ts` |
| SSE transport | `apps/web/src/session/transport.ts` |

## Non-negotiables

- Loopback-first security: token auth, HttpOnly SameSite=Strict cookie, same-origin checks. Do not weaken these without a documented decision.
- Flow topology is user-owned: agents can never create/remove edges themselves.
- Markdown rendering must stay behind `rehype-sanitize`.
