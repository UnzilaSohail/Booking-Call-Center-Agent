# Design tokens (Jira 24c)

Extracted from the live dashboard stylesheet (`dashboard/app/globals.css`) — the actual
values already in production, not a new design system. `PLAN_3_GUI.md` covers the audit
findings and improvement plan (Jira 24a/24b); this file is just the token reference those
fixes should build on instead of hand-picking new colors/spacing per component.

## Color

| Token | Value | Use |
|---|---|---|
| `--bg` | `#eef3f5` | Page background |
| `--surface` | `#ffffff` | Cards, panels |
| `--surface-alt` | `#e3ebee` | Hover/alt row background |
| `--border` | `#cfd9dd` | Default border |
| `--border-strong` | `#a9b8bd` | Emphasized border |
| `--text` | `#16324a` | Body text |
| `--text-muted` | `#4d5c66` | Secondary text |
| `--text-faint` | `#85949c` | Tertiary/label text |
| `--ink` | `#17344a` | Primary dark (buttons, active nav) |
| `--ink-hover` | `#234a63` | Ink hover state |
| `--ink-text` | `#f2f6f7` | Text on ink background |
| `--accent` | `#2563eb` | Links, focus, primary actions |
| `--accent-soft` | `#dbeafe` | Accent background tint |
| `--success` / `--success-soft` | `#16a34a` / `#dcfce7` | Positive states |
| `--warning` / `--warning-soft` | `#d97706` / `#fef3c7` | Caution states |
| `--danger` / `--danger-soft` | `#dc2626` / `#fee2e2` | Errors, destructive actions |
| `--info` / `--info-soft` | `#0891b2` / `#cffafe` | Informational states |
| `--violet` / `--violet-soft` | `#7c3aed` / `#ede9fe` | Used sparingly for a distinct accent (e.g. AI-attributed value) |

Sidebar-only swatches (do not reuse elsewhere — see inline comments in globals.css):
`--swatch-1` (#1a3a52, sidebar bg), `--swatch-2` (#235068, active item bg), `--swatch-4`
(#8ab4c4, active item border accent). `--swatch-5` (#d7dbdd) is the one exception already
reused as a shared pale-neutral.

## Typography

- Body: system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`), 14px base.
- Headings / emphasis numbers: `--font-serif` = `'Fraunces', Georgia, serif` — used for
  h1/h2, stat values, sidebar brand, not body copy.
- Scale in use: 10.5px (table headers), 11.5px (field labels, badges), 12–13.5px (body
  small / trends), 16.5–22px (h2/h1), 26–27px (stat values).
- Label convention: uppercase + `letter-spacing: 0.05–0.06em` for table headers and field
  labels — keep this pairing when adding new ones rather than picking a new label style.

## Shape & elevation

- Radius: `--radius-sm` 5px, `--radius` 8px (default), `--radius-lg` 10px.
- Shadow: `--shadow` (subtle, cards) / `--shadow-lg` (modals, popovers).

## Layout

- `--sidebar-w`: 216px fixed sidebar.
- **Breakpoints found: only two, and only scoped to `.stat-cards`** — `860px` (drop to 2
  columns) and `520px` (drop to 1 column). No general responsive system exists yet
  (PLAN_3_GUI.md G6 "Mobile pass" is the fix for this — tables/forms/sidebar still need
  their own breakpoint handling, not just the stat cards).

## Known inconsistencies to fix under G3/G4 (not fixed by this doc alone)

- Single 378-line global stylesheet, no per-component scoping.
- ~17 plain "Loading..." text strings instead of skeleton loaders.
- Native `confirm()` dialogs instead of the app's own modal.
- FullCalendar's own CSS variables (`--fc-*`) are re-mapped to these tokens at the bottom
  of globals.css — keep that mapping in sync if any core token above changes.
