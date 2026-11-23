# Local product distribution

The application package is built from the workspace, rather than asking end users to clone it. This is a local tarball distribution, not a registry release or desktop installer.

## Entries and ownership

`src/main.ts` is the installed `piflow` bin. `src/index.ts` is the workspace entry. Both use `runCli`, which owns argument parsing, signal handlers, authenticated readiness and optional browser opening. `bootstrap` owns application resources and shutdown. CLI project paths come from the actual caller cwd or an explicit positional argument; package-manager `INIT_CWD` does not override them.

Installed resources are resolved relative to the actual product entry. Host, project worker, existing Code/Review extensions and Web assets are explicit artifacts. The worker uses plain JavaScript and the same Node executable as the Host. Neither a development loader nor a global pi installation is required.

The default loopback port is 3141, falling back to an available port on collision. `--port` or `PORT` makes the port explicit and disables fallback. Binding off loopback retains the existing explicit-token policy; auto-opening a browser is restricted to loopback. `--no-open`, SSH and headless Linux suppress opening.

## Build and pack

`pnpm build` compiles protocol/server/Web and stages `dist/app`. esbuild bundles owned server/protocol code, preserving explicit worker and extension entries. Third-party server dependencies are external, declared in the generated manifest, and pinned to the exact installed versions. npm resolves their transitive dependencies on installation; this tarball is not an offline or fully locked dependency closure.

Build checks inspect the actual transitive bundler inputs, including browser and worker graphs. Browser builds reject server/Node/test inputs; worker builds reject Host/feature implementations; production imports must have a declared external dependency. Web output includes the bundled dependencies' license notices.

`dist/build-info.json` records application/pi versions, private IPC version, source commit/dirty state, a source-input digest and exact owned artifact hashes. The existing HTTP interface is unversioned, so its record field is `null`. The record is an integrity/consistency check, not a signature or proof of dependency authenticity. Installed startup verifies owned files before opening user data and checks the installed pi version.

`pnpm pack:app` validates the stage and source fingerprint, then runs `npm pack --ignore-scripts`. It never silently rebuilds. The generated package has no workspace references, install hooks or development dependencies.

## Acceptance

`pnpm test:dist` requires an existing tarball. It installs with production dependencies in a temporary directory outside the checkout, then uses plain Node to verify CLI help/version, project resolution, Web assets, cookie authentication, same-origin checks, real SDK worker prompts and a scripted bash tool roundtrip. It also loads the packaged legacy extensions, stops the Host on SIGINT/SIGTERM, verifies worker exit and lease reacquisition, and checks restart without input replay. Forced Host loss retains an uncertain submission outcome. Missing/mixed worker or Web artifacts and missing production dependencies fail startup before data access.

The provider and data directories are isolated; the test sends no paid-model requests. `PIFLOW_TEST_NODE=/absolute/path/to/node pnpm test:dist` runs installed Host/worker/extension acceptance with another Node version without changing the shell default. Native browser-launch adapters are covered through an injected adapter; platform-specific installation and opening behavior require acceptance on that platform.

## Current migration scope

The new worker-backed interface is `/api/execution/sessions`. Browser chat, Flow and child CLI execution still use the prior path until P2. Both paths are included in the product; packaging does not introduce a second future runtime or claim the UI migration is complete. Native pi history and local user data are retained. Startup never automatically replays an interrupted input.
