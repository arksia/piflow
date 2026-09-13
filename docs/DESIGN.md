# piflow DESIGN.md

Quiet dark workspace. Black ground stays. Type, spacing, and cards may be rebuilt.

## Direction

One project, one workspace. Chat is primary. Flow is the same sessions from above. Only blocked, failed, or review-ready work should shout.

Do not become an IDE. Do not copy PiChamber density. Do not invent a second brand.

## Tokens

| Token | Value | Role |
|---|---|---|
| `--c-bg` | `#000` | App ground |
| `--c-raise` | `#0f0f0f` | Hover / raised surface |
| `--c-press` | `#171717` | Pressed / selected |
| `--c-line` | `#222` | Hairline |
| `--c-ink` / `--c-mid` / `--c-body` / `--c-muted` / `--c-faint` | white ramp | Type hierarchy |
| `--space-*` | 4 / 8 / 12 / 16 | Grid |
| `--chrome-h` | 48px | Sidebar, chat, and Flow headers |
| `--control` | 32px | Icon and compact text controls |
| `--icon` | 16px | Lucide size |
| `--radius-control` | 6px | Buttons, switch, search |

## Chrome

- Sidebar header, chat header, and Flow header share `--chrome-h` and vertical centering.
- Icon-only actions use `IconButton`. Same size, hover, active, disabled, focus-visible, `title` + `aria-label`.
- Primary chrome actions stay visible. Secondary actions go behind overflow or stay out of the header.
- Desktop: `PanelLeftClose` collapses the sidebar; `PanelLeft` appears only when it is collapsed. Mobile: one `PanelLeft` opens the drawer.
- `ViewSwitch` is `--control` tall and sits on the same row as icon buttons.
- The header title is identity only. Session-tree navigation is an action labeled 分支, and only appears when the conversation actually has a fork.

## Interaction

Every clickable control must have hover, active, disabled, and `:focus-visible`. Native `title` is enough for icon tooltips. Do not use raw glyphs (`☰`, `⇔`, `+`) as chrome.

## Sequence

A craft and chrome → B session status language → C chat review cards → D Chat / Flow as one workspace.
