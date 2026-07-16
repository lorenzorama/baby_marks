# Baby Marks — "Soft & Warm" UI Overhaul Spec

**Date:** 2026-07-16
**Status:** Approved by user
**Scope:** Presentation only. No API, hook, schema, or behavior changes. New i18n keys allowed (mirrored fr/en). All existing tests stay green.

## Goals

Bigger, more readable text; cuter, warmer look; better one-handed ergonomics; clearer visual hierarchy. Personality: **soft & warm** — rounded, pastel-accented, calm; not a busy toy-store look.

## 1. Theming architecture (Approach A: semantic tokens)

- All colors defined once as CSS custom properties in `src/app/globals.css`, flipped by `@media (prefers-color-scheme: dark)`. Components never hardcode zinc/sky colors again.
- Tokens exposed to Tailwind 4 via `@theme inline` so components use utilities (`bg-surface`, `text-ink`, `bg-feed-tint`, etc.).
- `<meta name="theme-color">` uses media-aware entries (light + dark). Manifest colors updated to the light theme (single value limitation).
- `color-scheme: light dark` on `html` so form controls/scrollbars follow.

### Token set

| Token | Light | Dark |
|---|---|---|
| `--color-bg` | `#faf6f1` warm cream | `#1c1917` warm charcoal |
| `--color-surface` | `#ffffff` | `#292524` |
| `--color-surface-2` (inputs, inset) | `#f5efe8` | `#1f1b18` |
| `--color-ink` | `#3f3730` | `#f5efe8` |
| `--color-ink-soft` (secondary text) | `#8a7d70` | `#a89d90` |
| `--color-line` (borders) | `#eadfd3` | `#3b352f` |
| `--color-primary` (buttons/active) | `#e0776b` terracotta | `#e88a7d` |
| `--color-success` | `#4d9e6f` | `#6fbf8f` |
| `--color-danger` | `#d05b5b` | `#e07a7a` |

Per-activity accents, each with `-accent` (strong: icons, bars, dots) and `-tint` (soft background) variants. **Accent values validated with the dataviz palette validator** (lightness band, chroma floor, CVD separation, contrast vs surface — all PASS in both modes; single light-mode contrast WARN on feed is relieved by visible ink value-labels on every bar):

| Activity | Accent (light/dark) | Tint (light/dark) |
|---|---|---|
| feed | `#d97c4e` / `#d0703f` peach | `#f9e8dd` / `#3a2a1f` |
| sleep | `#8672c9` / `#967ecf` lavender | `#ece7f8` / `#2d2839` |
| diaper | `#3f9d70` / `#43a173` mint | `#e0f1e8` / `#21322a` |
| pump | `#cc6690` / `#cc6a95` rose | `#f8e6ee` / `#38262e` |
| medicine | `#b78b2e` / `#b0872b` butter | `#f5edd8` / `#332c1c` |
| growth | `#3f87b8` / `#4f94c4` sky | `#e2eef6` / `#223039` |

Tints are decorative backgrounds only (never carry data). Charts consume accent tokens; chart text (values, axis labels) always wears ink tokens, never the series color. Each chart is single-series — no legends needed, the section title names the series.

## 2. Typography & ergonomics

- Base font-size 17px (`html`), line-height comfortable; `-apple-system` stack kept.
- Scale: page titles `text-2xl font-bold`; section headers `text-base font-semibold` (up from `text-sm`, no more all-muted); card values `text-lg`; secondary text `text-sm` minimum (nothing below 12px except chart axis labels).
- Timer digits: `text-5xl` tabular numerals.
- Tap targets ≥ 48px; action-grid buttons ≥ 72px tall with 30px icons and `text-[13px]` labels.
- Radii: cards `rounded-3xl`, buttons/chips `rounded-2xl`/full; soft shadows in light theme (`shadow-sm` warm), none needed in dark.
- Spacing: screens `p-5 space-y-6`; cards `p-4`+.

## 3. Screen-by-screen

**Home** — running timer = hero card: activity tint background, accent left icon in a circle badge, huge digits, big accent Stop button (min 56px). Action grid: 4 columns × 2 rows; each button surface-colored with the activity's tint icon-badge; Sein G/D top-left. Time-since: 3 cards with activity icon badge + bold value + soft label. Timeline: rows on surface with tinted circular icon badge, primary line `text-base`, secondary `text-sm`; caregiver chip (M/P) in a small rounded badge.

**History** — chips: pill per type with icon + localized label (use existing `actions.*` keys) in activity tint when active, surface otherwise; "Tout/All" uses primary. Day headers `text-base font-bold text-ink` with soft divider. Rows identical to Home timeline. Load-more = big surface button.

**Stats** — each section card gets its activity tint header row (icon badge + title). BarChart: bars use activity accent, value labels `text-xs`, weekday labels `text-xs`; rounded bar tops. LineChart: stroke/dots use growth accent, labels `text-xs`, dots bigger. Measurement form inside a surface card with labeled inputs (visible labels above inputs, not placeholder-only).

**Settings** — sections as surface cards with icon+title headers; segmented toggles use primary when active; logout stays quiet (text-danger on surface).

**Login** — centered card on bg: big 🍼 in a tinted circle, `text-3xl` title, subtitle line, large input (56px) and primary button; error in danger tint box.

**Bottom nav & sheets** — nav 64px + safe-area, icons `text-2xl`, active tab gets a primary-tinted pill behind icon+label. Sheets: `rounded-t-3xl`, grab handle bar, title `text-xl`, inputs 52px, primary buttons full-width 52px. Toast: keeps success/error variants, mapped to tokens.

**EditEventSheet** — same sheet treatment; field labels visible; delete = danger-tint button, save = primary.

## 4. Implementation notes

- New/changed files: `globals.css` (tokens + @theme), `layout.tsx` (viewport themeColor array), `manifest.ts` (colors), and presentation-only edits to all components/pages listed above.
- New i18n keys: only if a visible label is added (e.g. input labels reuse existing `stats.*`/`sheets.*` keys where possible); any addition mirrored fr/en.
- No new dependencies.
- Verification: `npm run test` (52), `tsc --noEmit`, `npm run build`, then browser screenshots of all 5 screens at 390px width in light AND dark (emulated) to confirm hierarchy/contrast; quick interaction pass (start/stop timer, open sheets, filter history).

## Out of scope

Manual theme toggle (follows system only), pinch-zoom change, component library adoption, icon-font/SVG icon system (emoji stay), behavioral changes of any kind.
