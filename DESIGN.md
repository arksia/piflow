# Design Review

Target: `web`
Date: `2026-07-31`

## Summary

This UI is coherent and restrained, but it under-communicates. It feels more like an internal developer console than a polished chat workspace.

## What Works

- Dark palette is consistent and avoids generic SaaS styling.
- The flow from session list to conversation to composer is easy to follow.
- Tool output is progressively disclosed instead of overwhelming the transcript.

## Priority Issues

### P1 - Cryptic controls and jargon

Controls rely on glyphs or internal words: `⇔`, `■`, `steer`, `thinking`, and the streaming indicators. These force recall instead of recognition.

Fix:
- Replace glyph-only controls with visible labels or clearer icons.
- Add `aria-label` where visual labels are intentionally compact.
- Rename internal terms like `steer` and `thinking` into plain language.

Relevant files:
- [`web/src/components/ChatView/index.tsx`](./web/src/components/ChatView/index.tsx)
- [`web/src/components/InputBar/index.tsx`](./web/src/components/InputBar/index.tsx)

### P1 - Flattened hierarchy from opacity

The global `.recede` style lowers contrast across too many interactive elements. Active, secondary, and disabled states start to look alike.

Fix:
- Remove blanket fading from shared interactive styles.
- Use explicit semantic colors for secondary text.
- Strengthen selected, hover, and focus-visible states.

Relevant files:
- [`web/src/styles/main.css`](./web/src/styles/main.css)
- [`web/src/components/SessionList/styles.module.css`](./web/src/components/SessionList/styles.module.css)

### P1 - State overload

Multiple pulsing dots, the animated ring, blinking caret, and streaming borders all compete for attention.

Fix:
- Keep one visible status indicator per region.
- Add readable text status such as `Running`, `Waiting`, or `Stopped`.
- Respect reduced motion for every animated state.

Relevant files:
- [`web/src/components/ChatView/styles.module.css`](./web/src/components/ChatView/styles.module.css)
- [`web/src/components/InputBar/styles.module.css`](./web/src/components/InputBar/styles.module.css)
- [`web/src/components/MessageItem/styles.module.css`](./web/src/components/MessageItem/styles.module.css)

### P2 - Tool output is truncated too aggressively

Tool summaries and outputs are shortened early, which hides important context and makes file-changing actions feel less explicit.

Fix:
- Add explicit expand/copy affordances.
- Keep full output accessible.
- Visually distinguish mutation, success, and failure states.

Relevant files:
- [`web/src/components/ToolCallCard/index.tsx`](./web/src/components/ToolCallCard/index.tsx)
- [`web/src/components/ToolCallCard/styles.module.css`](./web/src/components/ToolCallCard/styles.module.css)

### P2 - Mobile and popover safeguards are thin

The sidebar scrim is a plain `div`, and the model picker is click-away only. Keyboard dismissal and focus restoration are not explicit.

Fix:
- Add dialog or popover semantics.
- Support Escape-to-close.
- Restore focus after closing.
- Expose `aria-expanded` and a clearer dismissal path.

Relevant files:
- [`web/src/App.tsx`](./web/src/App.tsx)
- [`web/src/App.module.css`](./web/src/App.module.css)
- [`web/src/components/InputBar/index.tsx`](./web/src/components/InputBar/index.tsx)

## Deterministic Scan Notes

- `layout-transition` warning in `web/src/components/ChatView/styles.module.css`
- `layout-transition` warning in `web/src/components/InputBar/styles.module.css`
- `side-tab` warning in `web/src/components/MessageItem/styles.module.css`

## Follow-up

The fastest path is to fix the P1s first:

1. Make controls readable.
2. Replace blanket opacity fading with clearer state styles.
3. Collapse the many motion cues into one state model.
