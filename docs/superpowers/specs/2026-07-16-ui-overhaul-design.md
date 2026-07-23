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
- Timer digits: `text-3xl` tabular numerals (reduced from 5xl — overflow at 390px).
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

---

## Addendum (2026-07-20, approved): tablet/web mode, layout switch, touch time picker

**Context change:** repo restructured — Next app now in `frontend/` (API route handlers removed), Python FastAPI backend in `backend/` (same API contract, same `bm_auth` HMAC cookie), Postgres via docker-compose. All frontend paths in this spec/plan now live under `frontend/`.

### Layout modes
- Modes: `mobile` (today's layout: bottom tabs, single column) and `web` (iPad/desktop: top-bar nav, centered max-width, Home in two columns).
- Selection: `auto` (viewport ≥768px → web) with manual override `mobile`/`web`; setting persisted in `localStorage.bm_layout`; exposed by a `useLayoutMode()` context (`{ setting, mode, setSetting }`), SSR-safe (defaults to mobile until mounted).
- A slim TopBar on all screens except /login: app name left; Auto/Mobile/Web segmented switch right (44px+ targets); in web mode it also carries the four nav links and BottomNav hides.
- Web-mode layouts: Home `max-w-5xl`, two columns (timers+action grid | time-since+timeline); History/Settings `max-w-2xl`; Stats `max-w-3xl` with 2-up chart card grid. Tap targets stay ≥48px in both modes.
- New mirrored keys: `mode.auto/mobile/web`.

### Touch time picker (mobile/tablet mode)
- `TimeWheelPicker` bottom sheet: day row (Aujourd'hui/Hier chips + native date input for older dates), hour+minute scroll-snap wheels (48px rows, snap-center, primary-tint selection band), quick chips **Maintenant / −5 / −15 / −30 min**, Done button. For the *end* field: an extra "still running (no end)" chip clears the value.
- EditEventSheet start/end fields become picker-opening buttons in mobile mode; web mode keeps native `datetime-local` inputs. Saved payloads unchanged.
- New mirrored keys: `picker.today/yesterday/now/done/noEnd`.
- Ring/dial picker explicitly rejected (slower for exact minutes); wheels+chips chosen.

### Migration hygiene (from backend-split review)
- `frontend/src/proxy.ts`: exempt `/api/health` from the auth gate (backend exposes it unauthenticated for probes).
- Rewrite `README.md` for the new architecture (docker compose up; services db/backend/frontend; env vars incl. `COOKIE_SECURE`, `APP_SECRET_PHRASE` on both services; note that `BACKEND_URL` is a frontend build-time arg); refresh `.env.example`s.
- Document (not fix): no CORS middleware (same-origin by design); backend integration tests require `BM_TEST_DATABASE_URL`.

### Verification gates (updated for the split)
- Frontend: `cd frontend && npm run test` (remaining vitest suites) + `npx tsc --noEmit` + `npm run build`.
- Backend: `cd backend && python3 -m pytest` (15 tests; API suite skips without `BM_TEST_DATABASE_URL`).
- Visual pass: 390px / 820px / 1280px, light+dark, mobile+web modes.
