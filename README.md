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

## Development

Requires Node.js **22.13 or newer**. Run history uses Node’s built-in SQLite.

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3142](http://localhost:3142). The Node server runs on port `3141`; Vite runs on `3142` with HMR.

## Production

```bash
pnpm build
pnpm start
```

The product is split into `packages/web` and `packages/server`. The server runs from TypeScript source via `tsx`, serves `packages/web/dist`, and listens at [http://127.0.0.1:3141](http://127.0.0.1:3141).

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
