# piflow DESIGN.md

Warm charcoal workspace. Chat is a document in one project. Flow is the same sessions from above.

## Direction

Surfaces stack: window → sidebar → selected row → reading column → cards. Failed and in-progress work are asides in the document, not banners. Only something that still needs a human decision should shout.

Do not become an IDE. Do not copy PiChamber's folder tree or activity rail. Do not invent a second brand color.

Quiet is the default. Secondary actions stay invisible until hover. Hairlines separate chrome; shadows belong on floating layers, not the reading column.

## Tokens

| Token | Value | Role |
|---|---|---|
| `--c-bg` / `--c-sidebar` | `#141414` | Sidebar and top bars |
| `--c-doc` / `--c-raise` / `--c-code-bg` | `#181818` | Chat, Flow canvas, cards, composer |
| `--c-press` | `#252525` | Selected row, pressed, user prompt |
| `--c-line` | `#2a2a2a` | Hairline |
| `--c-ink` / `--c-mid` / `--c-body` / `--c-muted` / `--c-faint` | neutral white ramp | Type hierarchy |
| `--space-*` | 4 / 8 / 12 / 16 | Grid |
| `--chrome-h` | 48px | Sidebar, chat, and Flow headers |
| `--control` | 32px | Chrome icon and compact text controls |
| `--icon` | 16px | Lucide size in chrome |
| `--radius` | 10px | Document cards, composer |
| `--radius-control` | 8px | Buttons, switch, selected row |
| `--chat-w` | 820px | Reading column |
| `--ease` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Emphasized ease |
| `--duration-fast` / `--duration` | 120ms / 180ms | Hover vs expand |

`IconButton` sizes: chrome 32px, compact 24px, in-transcript mini 20px.

## Transcript

The message column is the first region tuned as a complete grammar. Later regions should match it, not invent a second one.

- Measure is 820px centered. Body is 14px / 1.65, with CJK overflow-wrap. Do not stretch with the window.
- A **turn** (user, assistant, pending) is 24px from the next turn. Inside an assistant turn, thinking / tools / markdown sit on a 12px grid — one round of work, not three cards.
- Short user prompts are left-aligned chips; prompts that wrap or exceed ~36 characters fill the column. Not right-aligned bubbles.
- Thinking and failure are **voices**, not labels. No `思考` / `失败` stamp, no cards, no wash. Typography carries the type.
- Thinking is italic muted. Collapsed, two real lines fade out (mask, not an ellipsis chip). Click the fade to open; a gutter chevron appears on hover. Streaming starts open and the text itself breathes. No “进行中”.
- Failure is one human sentence in muted rose (`#c4a09a`). Parse `401 {json}` down to `Invalid Authentication`. Never dump the blob.
- Tool rows stay flush document lines. Timestamps are 11px `--c-faint`. Copy is a mini icon, visible on hover (always visible on coarse pointers). Copy confirms with a check for 1.6s. Fork stays in the session menu.

## Chrome

- Sidebar is a darker sheet against the window. The active session is a filled pill, not a left tick.
- The composer docks in the same column as the transcript. (Composer layering is not tuned yet; do not treat the current footer-inside-the-box as the contract.)
- Icon-only actions use `IconButton`. Hover, active, disabled, focus-visible, `title` + `aria-label`.
- Desktop: `PanelLeftClose` collapses the sidebar; `PanelLeft` appears only when it is collapsed. Mobile: one `PanelLeft` opens the drawer.
- `ViewSwitch` is `--control` tall and sits on the same row as icon buttons.
- The header title is identity only. Session-tree navigation is an action labeled 分支, and only appears when the conversation actually has a fork.
- Usage sits in the chat header.

## Interaction

Every clickable control must have hover, active, disabled, and `:focus-visible`. Native `title` is enough for icon tooltips. Do not use raw glyphs (`☰`, `⇔`, `+`) as chrome. Respect `prefers-reduced-motion`.
