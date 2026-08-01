# Product

Name: `piflow`
Platform: `web`
Register: `product`
Date: `2026-07-31`

## What This Product Is

`piflow` is a local web workspace for managing coding-agent sessions. It is not a generic chat app and not a marketing site. The user opens a session, sends prompts, inspects tool work, and continues work across multiple conversations tied to a codebase.

## Primary Users

- A developer working in a repository with an active coding agent.
- A power user who wants to resume prior sessions, inspect agent output, and steer an ongoing turn.
- An occasional collaborator who needs to understand what the agent is doing without reading raw logs.

## Core Jobs

1. Start a new session.
2. Re-open an existing session.
3. Send a prompt or follow-up.
4. See whether the agent is streaming, compacting, waiting, or finished.
5. Inspect tool calls, diffs, and command output.
6. Switch model or thinking mode when needed.
7. Track context usage and usage quotas.

## Information Architecture

- Left sidebar: session list grouped by working directory.
- Main area: conversation timeline.
- Bottom composer: prompt entry, model/thinking controls, quota, and send/abort.
- Tool cards: collapsible operational details inside the transcript.

## Behavioral Rules

- The active session should stay recoverable after refresh.
- Session grouping by cwd is part of the product model.
- Streaming state must be visible without opening devtools.
- Tool calls should remain inspectable, especially when they mutate files or run commands.
- Queueing and steer behavior need to be understandable in plain language.

## Interaction Principles

- Prefer familiar controls over clever ones.
- Prefer visible labels over glyph-only affordances.
- Prefer explicit state text over only color or motion.
- Keep the interface dense, but do not make it cryptic.
- Use click-away sparingly and always provide a keyboard path.

## Visual Direction

- Dark, restrained, technical.
- High contrast for body text and primary actions.
- Secondary information should remain legible, not faded into the background.
- Motion should signal state changes, not decorate the page.

## State Model

The UI should clearly distinguish:

- disconnected
- connecting
- idle
- streaming
- compacting
- queued / steer pending
- warning / error
- disabled / unavailable

## Constraints

- This is a product UI, so consistency matters more than surprise.
- Standard controls should remain standard.
- Mobile behavior must stay usable, even if the primary audience is desktop.
- Accessibility and keyboard support are required, not optional polish.

## Non-Goals

- Marketing visuals.
- Decorative animation.
- Novel control metaphors.
- Overly abstract terminology.

## What Good Looks Like

- A new user can understand the main actions in seconds.
- A power user can scan state and tool output quickly.
- The interface feels calm, technical, and trustworthy.
- The UI explains itself without forcing the user to learn internal language.
