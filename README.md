# piflow

Stay in your flow. Let pi do the work.

piflow is a browser interface for the pi coding agent. It reads and writes the same local sessions as the terminal client.

## Features

- **Multiple sessions**: browse, create, and switch sessions backed directly by `~/.pi/agent/sessions/`. Pick up the same work later with `pi -c` in your terminal.
- **Streaming chat**: Markdown rendering, Shiki syntax highlighting, and collapsible thinking blocks.
- **Tool cards**: inspect tool calls, output, errors, and file diffs.
- **Steering**: send another message while the agent is running and it joins the turn as steering input.
- **Abort**: stop the active agent turn from the browser.

- **Run observability**: open “运行记录” from Flow to inspect concurrent subagent timelines, tool steps, output, configuration snapshots, and parent calls, or cancel active runs.

## Local installation

Requires Node.js **22.19.0 or newer** (development uses 24.22.1). piflow includes its pi runtime dependency; no global pi or pnpm is needed to run an installed package.

There is no registry release yet. Install a locally built tarball:

```bash
npm install -g /absolute/path/to/piflow-0.1.0-dev.0.tgz
piflow /path/to/project
```

The CLI opens the browser after the authenticated Host is ready. Omit the project to use your current directory. `--no-open` skips browser opening; `--port 0` selects a free port; `--help` and `--version` show usage and the bundled pi version. SSH and headless Linux sessions print the address without opening a browser. The default port is 3141; if occupied, piflow chooses a free port. An explicitly requested port fails when occupied.

Configure models and credentials through pi's native configuration (`~/.pi/agent`, or `PI_CODING_AGENT_DIR`). Stop with Ctrl-C. Restarting preserves native history and recorded submission outcomes; it never automatically replays interrupted inputs.

## Development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3142](http://localhost:3142). The Node server runs on port `3141`; Vite runs on `3142` with HMR. Node's built-in SQLite stores execution facts.

## Build and installation acceptance

```bash
pnpm check          # lint, types, tests, build-policy tests, production build
pnpm pack:app       # verify the existing build and create dist/piflow-<version>.tgz
pnpm test:dist      # install in a temporary directory and exercise real HTTP + SDK workers
```

`pack:app` does not rebuild. If build inputs or artifacts changed, rebuild first. The product stage in `dist/app` contains a standalone manifest, executable CLI, Host, worker, extensions, Web, license notices and a file-digest build record. Third-party server dependencies are installed by npm. `pnpm start` remains a developer command for the compiled workspace; use the installed `piflow` bin to verify product distribution.

The worker-backed execution interface is currently `/api/execution/sessions`. Browser chat, Flow and delegated runs still use the existing execution path pending the next migration; shipping a package does not imply that migration is complete. Installed artifacts include those existing extensions as well.

### LAN Access

Loopback access needs no setup. Binding to another interface requires an explicit token with at least 24 URL-safe characters:

```bash
PIFLOW_TOKEN=replace-this-with-a-long-random-token HOST=0.0.0.0 pnpm start
```

On first access, open:

```text
http://your-host:3141/?token=replace-this-with-a-long-random-token
```

piflow stores the token in an HttpOnly cookie and removes it from the address bar after authentication. Prefer Tailscale or another trusted private network because plain HTTP does not encrypt traffic.

Run records are stored separately from Flow topology in `~/.piflow/runs.sqlite` (override with `PIFLOW_DATA_DIR`). Existing embedded run records are imported automatically. On restart, unfinished records are marked interrupted; executions are not resumed. Only one server may own a data directory at a time.
