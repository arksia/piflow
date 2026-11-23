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
│       ├── bootstrap.ts # Host resource ownership and shutdown
│       ├── cli.ts      # CLI arguments, readiness, browser and OS signals
│       ├── distribution/ # Entry-relative resources and product integrity checks
│       ├── facts/      # Host-owned SQLite connection, migrations and submission facts
│       ├── runtime/    # Project worker IPC and lifecycle (core HTTP wired; UI migration pending)
│       ├── plugins/    # Support plugins (auth)
│       ├── routes/     # Route plugins
│       ├── server/     # Config, static files, SSE
│       ├── sessions/   # pi session store
│       ├── flow/       # Flow canvas domain: store, tools
│       ├── usage/      # Provider quota adapters
│       ├── test/       # Mirrors the folders above
│       ├── index.ts    # Workspace development/compiled entry
│       └── main.ts     # Installed product bin
├── web/             # React 19 + Vite frontend
│   └── src/
│       ├── components/  # Flat component folders (index.tsx + styles.module.css)
│       ├── session/     # Global state: reducer, store, transport, api
│       ├── flow/        # Flow canvas HTTP client
│       └── markdown/    # Streaming markdown pipeline (shiki, sanitize)
packages/
└── protocol/        # @piflow/protocol — browser/HTTP wire contracts; built to dist

scripts/             # Coordinated dev lifecycle, product build/pack and acceptance
docs/                # Public product requirements
```

## Commands

```bash
pnpm install        # install all workspaces
pnpm dev            # supervise server + web; protocol emit is a restart barrier
pnpm lint           # eslint + stylelint
pnpm typecheck      # tsc --noEmit across workspaces
pnpm test           # node:test across workspaces
pnpm build          # compile workspaces and stage standalone product in dist/app
pnpm pack:app       # verify existing build and create an installable tarball
pnpm test:build     # bundler policy, artifact integrity and dev lifecycle tests
pnpm test:dist      # install prior tarball and test HTTP + native pi workers
```

## Conventions

- **Language**: TypeScript, ES modules, `node:test` for tests.
- **Tests**: the server keeps them in `apps/server/src/test`, mirroring `plugins/`, `routes/`, and the domain folders. The web package keeps `foo.ts` beside `foo.test.ts`.
- **Component style**: `components/Name/index.tsx` + `styles.module.css`.
- **Protocol changes**: edit `packages/protocol/src/index.ts`; server and web consume it via `@piflow/protocol`.
- **Worker IPC**: private Host/worker messages live in `apps/server/src/runtime/messages.ts`, separate from browser wire contracts. Only explicit Session open may start a project worker; stale controls must never restart it or replay work.
- **Execution HTTP**: `/api/execution/sessions` controls worker-owned Sessions by canonical project path, native Session ID and generation. Submission queries read facts directly. See `docs/design/execution-sessions.md` for the current migration scope.
- **Development lifecycle**: the root `scripts/dev.mjs` owns Host/Vite/compiler processes. Watch sources, not protocol dist; stop consumers before a full protocol emit and restart only after success. Do not reintroduce independent watchers that can read a partial emit. Manifest/config/dependency changes require restarting `pnpm dev`.
- **Distribution**: runtime resources resolve from explicit entry URLs, never caller cwd. Build and pack are separate; pack refuses changed source inputs or artifact bytes. Third-party production dependencies stay external and version-pinned in the generated manifest. Tests install tarballs into temporary directories; never publish or install globally as a test.
- **Product scope**: [docs/PRD.md](docs/PRD.md) defines goals and explicit non-goals (piflow does not replace IDE, terminal, or Git hosting).

## Key entry points

| Concern | File |
|---|---|
| Installed CLI | `apps/server/src/main.ts` and `cli.ts` |
| Product assembly | `scripts/build-app.mjs` and `pack-app.mjs` |
| Workspace entry | `apps/server/src/index.ts` |
| Host resource ownership | `apps/server/src/bootstrap.ts` |
| Project execution lifecycle | `apps/server/src/runtime/index.ts` and `project-workers.ts` |
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
