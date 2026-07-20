# Soft & Warm UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every screen of Baby Marks with a warm token-based light/dark theme, bigger type, and friendlier ergonomics — zero behavior change.

**Architecture:** Semantic CSS custom properties in `globals.css` flipped by `prefers-color-scheme`, exposed as Tailwind 4 utilities via `@theme inline`. A tiny `src/lib/activity.ts` maps event types to icon/tint/accent classes. Components are re-skinned in place; all logic, props, hooks, and i18n behavior stay identical (a few NEW mirrored keys allowed).

**Tech Stack:** Tailwind CSS 4 (`@theme inline`), CSS custom properties, existing Next 16 app. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-16-ui-overhaul-design.md` (token hex values there are authoritative — validated with the dataviz palette validator).

## Global Constraints

- **Presentation only.** No change to hooks' logic, API calls, validation, or event handlers. Every behavioral line (guards, mutations, effects) is preserved verbatim when a file is restyled.
- All 52 existing tests stay green; `npx tsc --noEmit` and `npm run build` stay clean after every task.
- fr.json/en.json stay key-mirrored. New keys in this plan: `types.{feed,sleep,diaper,pump,medicine}`, `login.subtitle`.
- Base font 17px; tap targets ≥48px; timer digits `text-5xl`; nothing below `text-xs` except chart axis labels.
- Chart text wears ink tokens, never the series color. Tints are decorative only.
- Path has a space — always quote `"/Users/lorenzo/Desktop/Projects /baby_marks"`.
- Verify each task with the dev server; screenshot-based checks happen in Task 6 (both themes).

### Shared class recipes (use these exact strings; referenced by name below)

- `SCREEN` = `space-y-6 p-5 pb-28`
- `CARD` = `rounded-3xl bg-surface p-4 shadow-sm`
- `INPUT` = `w-full rounded-2xl border border-line bg-surface-2 px-4 py-3.5 text-base text-ink outline-none focus:border-primary`
- `PRIMARY_BTN` = `w-full rounded-2xl bg-primary py-3.5 text-base font-bold text-white disabled:opacity-50`
- `SECTION_H` = `mb-3 text-base font-semibold text-ink`
- `LABEL` = `mb-1 block text-sm font-medium text-ink-soft`
- `SEG_ON` = `flex-1 rounded-2xl bg-primary py-3 font-semibold text-white`
- `SEG_OFF` = `flex-1 rounded-2xl bg-surface-2 py-3 font-semibold text-ink-soft`

---

### Task 1: Design tokens, theme plumbing, shell components

**Files:**
- Modify: `src/app/globals.css` (replace), `src/app/layout.tsx` (viewport + body class), `src/app/manifest.ts` (colors), `src/components/Toast.tsx` (colors), `src/components/BottomNav.tsx` (replace styling), `src/components/Sheet.tsx` (replace styling)
- Create: `src/lib/activity.ts`

**Interfaces:**
- Produces Tailwind utilities: `bg`/`text`/`border` for `bg, surface, surface-2, ink, ink-soft, line, primary, success, danger, feed, feed-tint, sleep, sleep-tint, diaper, diaper-tint, pump, pump-tint, medicine, medicine-tint, growth, growth-tint`.
- Produces from `@/lib/activity`: `activityIcon`, `activityTint`, `activityAccentBg`, `activityAccentText` — all `Record<EventType, string>`.

- [ ] **Step 1: Replace `src/app/globals.css`**

```css
@import "tailwindcss";

:root {
  color-scheme: light dark;
  --bg: #faf6f1;
  --surface: #ffffff;
  --surface-2: #f5efe8;
  --ink: #3f3730;
  --ink-soft: #8a7d70;
  --line: #eadfd3;
  --primary: #e0776b;
  --success: #4d9e6f;
  --danger: #d05b5b;
  --feed-accent: #d97c4e;    --feed-tint: #f9e8dd;
  --sleep-accent: #8672c9;   --sleep-tint: #ece7f8;
  --diaper-accent: #3f9d70;  --diaper-tint: #e0f1e8;
  --pump-accent: #cc6690;    --pump-tint: #f8e6ee;
  --medicine-accent: #b78b2e; --medicine-tint: #f5edd8;
  --growth-accent: #3f87b8;  --growth-tint: #e2eef6;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1917;
    --surface: #292524;
    --surface-2: #1f1b18;
    --ink: #f5efe8;
    --ink-soft: #a89d90;
    --line: #3b352f;
    --primary: #e88a7d;
    --success: #6fbf8f;
    --danger: #e07a7a;
    --feed-accent: #d0703f;    --feed-tint: #3a2a1f;
    --sleep-accent: #967ecf;   --sleep-tint: #2d2839;
    --diaper-accent: #43a173;  --diaper-tint: #21322a;
    --pump-accent: #cc6a95;    --pump-tint: #38262e;
    --medicine-accent: #b0872b; --medicine-tint: #332c1c;
    --growth-accent: #4f94c4;  --growth-tint: #223039;
  }
}

@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-ink: var(--ink);
  --color-ink-soft: var(--ink-soft);
  --color-line: var(--line);
  --color-primary: var(--primary);
  --color-success: var(--success);
  --color-danger: var(--danger);
  --color-feed: var(--feed-accent);
  --color-feed-tint: var(--feed-tint);
  --color-sleep: var(--sleep-accent);
  --color-sleep-tint: var(--sleep-tint);
  --color-diaper: var(--diaper-accent);
  --color-diaper-tint: var(--diaper-tint);
  --color-pump: var(--pump-accent);
  --color-pump-tint: var(--pump-tint);
  --color-medicine: var(--medicine-accent);
  --color-medicine-tint: var(--medicine-tint);
  --color-growth: var(--growth-accent);
  --color-growth-tint: var(--growth-tint);
}

html {
  font-size: 17px;
}

body {
  background: var(--bg);
  color: var(--ink);
  -webkit-tap-highlight-color: transparent;
}
```

- [ ] **Step 2: `src/app/layout.tsx`** — replace the `viewport` export with:

```ts
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf6f1" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1917" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};
```

Body keeps `className="antialiased"` (colors now come from globals). Everything else unchanged.

- [ ] **Step 3: `src/app/manifest.ts`** — set `background_color: "#faf6f1"` and `theme_color: "#faf6f1"` (manifest supports one value; light chosen). Icons unchanged.

- [ ] **Step 4: Create `src/lib/activity.ts`**

```ts
import type { EventType } from "./types";

export const activityIcon: Record<EventType, string> = {
  feed: "🍼", sleep: "😴", diaper: "🧷", pump: "🥛", medicine: "💊",
};

export const activityTint: Record<EventType, string> = {
  feed: "bg-feed-tint", sleep: "bg-sleep-tint", diaper: "bg-diaper-tint",
  pump: "bg-pump-tint", medicine: "bg-medicine-tint",
};

export const activityAccentBg: Record<EventType, string> = {
  feed: "bg-feed", sleep: "bg-sleep", diaper: "bg-diaper",
  pump: "bg-pump", medicine: "bg-medicine",
};

export const activityAccentText: Record<EventType, string> = {
  feed: "text-feed", sleep: "text-sleep", diaper: "text-diaper",
  pump: "text-pump", medicine: "text-medicine",
};
```

- [ ] **Step 5: `src/components/Toast.tsx`** — styling only. The pill div's classes become:
`fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-2xl px-5 py-3 text-base font-medium text-white shadow-lg` + variant `bg-danger` (error) / `bg-success` (success). Keep the variant logic exactly as-is.

- [ ] **Step 6: Replace `src/components/BottomNav.tsx` styling** (logic — tabs array, pathname, `/login` hide, translations — unchanged):

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const tabs = [
  { href: "/", key: "home", icon: "🏠" },
  { href: "/history", key: "history", icon: "📖" },
  { href: "/stats", key: "stats", icon: "📊" },
  { href: "/settings", key: "settings", icon: "⚙️" },
] as const;

export default function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  if (pathname === "/login") return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="flex min-h-[64px] flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium"
          >
            <span
              className={`flex h-9 w-14 items-center justify-center rounded-full text-2xl ${active ? "bg-primary/15" : ""}`}
            >
              {tab.icon}
            </span>
            <span className={active ? "text-primary" : "text-ink-soft"}>{t(tab.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 7: Replace `src/components/Sheet.tsx`** (same props/behavior):

```tsx
"use client";

export default function Sheet({
  open, onClose, title, children,
}: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={onClose}>
      <div
        className="w-full rounded-t-3xl border-t border-line bg-surface p-5 pb-[calc(2rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line" />
        <h2 className="mb-4 text-xl font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Verify** — `npm run test` (52 pass), `npx tsc --noEmit` clean, dev server renders home with cream/charcoal background per OS theme, nav pill on active tab.

- [ ] **Step 9: Commit** — `style: warm design tokens, themed shell (nav, sheet, toast)`

---

### Task 2: Home screen restyle

**Files:**
- Modify: `src/components/EventItem.tsx`, `src/components/RunningTimers.tsx`, `src/components/ActionGrid.tsx`, `src/components/TimeSinceCards.tsx`, `src/app/page.tsx`

**Interfaces:**
- Consumes `@/lib/activity` maps. **No component prop or handler changes anywhere.**

- [ ] **Step 1: `src/components/EventItem.tsx`** — replace the local `icons` const with `activityIcon` import; row becomes:
  - button: `flex min-h-[60px] w-full items-center gap-3 rounded-2xl bg-surface px-3 py-3 text-left shadow-sm active:bg-surface-2`
  - icon badge (new wrapper around the icon): `<span className={\`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl ${activityTint[event.type]}\`}>{activityIcon[event.type]}</span>`
  - primary line: `block text-base font-medium`; secondary line: `block text-sm text-ink-soft`
  - caregiver chip: `rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-soft`
  `summarize`/`durationOf` exports and all props (incl. `caregiverLabels`) unchanged.

- [ ] **Step 2: `src/components/RunningTimers.tsx`** — hero card per running event (logic — useNow, update.mutate stop, `ts` side hook — unchanged):
  - card: `flex items-center gap-4 rounded-3xl p-5 ${activityTint[e.type]}`
  - icon badge: `flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface text-3xl` with `activityIcon[e.type] ?? "⏱"`
  - label line: `text-sm font-semibold text-ink-soft`
  - digits: `font-mono text-5xl font-bold tabular-nums`
  - Stop button: `min-h-[56px] rounded-2xl px-6 py-4 text-lg font-bold text-white active:opacity-90 ${activityAccentBg[e.type]}`

- [ ] **Step 3: `src/components/ActionGrid.tsx`** — grid + sheets restyle (ALL handlers/state/mutations byte-identical):
  - grid stays `grid grid-cols-4 gap-2`; button recipe `btn` becomes `flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-3xl bg-surface py-3 shadow-sm active:bg-surface-2`
  - each button's emoji gets a tinted badge: `<span className="flex h-11 w-11 items-center justify-center rounded-full text-2xl bg-<activity>-tint">` where the tint is the button's activity (nursing L/R + bottle + solids → `bg-feed-tint`, sleep → `bg-sleep-tint`, diaper → `bg-diaper-tint`, pump → `bg-pump-tint`, medicine → `bg-medicine-tint`); label `<span className="text-[13px] font-medium text-ink">`
  - `input` recipe → INPUT; `primary` recipe → PRIMARY_BTN + `min-h-[52px]`
  - diaper kind buttons: `rounded-2xl bg-diaper-tint py-4 text-base font-semibold text-ink active:opacity-80`

- [ ] **Step 4: `src/components/TimeSinceCards.tsx`** — (lastFeed completed-only logic unchanged) each card:
  `rounded-3xl bg-surface p-3 text-center shadow-sm` containing icon badge `mx-auto flex h-9 w-9 items-center justify-center rounded-full text-lg` + tint (`bg-feed-tint` / `bg-sleep-tint` / `bg-diaper-tint`), label `mt-1.5 text-xs font-medium text-ink-soft`, value `text-base font-bold text-ink`.

- [ ] **Step 5: `src/app/page.tsx`** — main becomes SCREEN; "today" header SECTION_H (`text-base font-semibold text-ink`, drop the muted `text-zinc-400`); empty text `text-sm text-ink-soft`; onboarding screen: icon in `flex h-24 w-24 items-center justify-center rounded-full bg-feed-tint text-5xl`, title `text-2xl font-bold`, text `text-base text-ink-soft`, CTA PRIMARY_BTN shape (`rounded-2xl bg-primary px-8 py-4 text-base font-bold text-white`). Editing state/EditEventSheet wiring unchanged.

- [ ] **Step 6: Verify** — tests + tsc; dev server: home shows hero timer card in activity tint when a timer runs, bigger grid buttons with tinted badges.

- [ ] **Step 7: Commit** — `style: warm home screen (hero timers, tinted action grid, cards)`

---

### Task 3: History + EditEventSheet restyle (+ types.* keys)

**Files:**
- Modify: `src/app/history/page.tsx`, `src/components/EditEventSheet.tsx`, `src/messages/fr.json`, `src/messages/en.json`

- [ ] **Step 1: Add mirrored `types` group**
fr: `"types": { "feed": "Repas", "sleep": "Dodo", "diaper": "Couches", "pump": "Tire-lait", "medicine": "Médocs" }`
en: `"types": { "feed": "Feeds", "sleep": "Sleep", "diaper": "Diapers", "pump": "Pump", "medicine": "Medicine" }`

- [ ] **Step 2: `src/app/history/page.tsx`** — (query/filter/editing logic unchanged) restyle:
  - main SCREEN; title `text-2xl font-bold`
  - chips: replace emoji-only buttons with icon+label pills using `const tt = useTranslations("types");`:
    active: `` `flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold ${activityTint[type]} ${activityAccentText[type]}` ``; "all" active: `bg-primary/15 text-primary`; inactive: `flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-surface px-4 py-2 text-sm font-semibold text-ink-soft shadow-sm`
    content: `<span>{activityIcon[type]}</span>{tt(type)}` ("all" chip: `{t("history.all")}` text only). aria-labels can be dropped since chips now have visible text.
  - day headers: `mb-2 text-base font-bold capitalize text-ink`
  - load-more: `w-full min-h-[48px] rounded-2xl bg-surface py-3 text-sm font-semibold text-ink-soft shadow-sm`

- [ ] **Step 3: `src/components/EditEventSheet.tsx`** — (ALL logic — date guards, merge, mutations, td/ts hooks — unchanged) restyle:
  - `input` → INPUT (py-3 ok for datetime), `label` → LABEL
  - side / diaper-kind / caregiver toggles: selected `rounded-2xl bg-primary py-3 font-semibold text-white`, unselected `rounded-2xl bg-surface-2 py-3 font-semibold text-ink-soft`
  - running note: `mt-1 text-xs font-medium text-sleep`
  - delete: `flex-1 rounded-2xl bg-danger/15 py-3.5 font-bold text-danger`; save: `flex-[2] rounded-2xl bg-primary py-3.5 font-bold text-white`

- [ ] **Step 4: Verify** — tests + tsc; dev: chips show labels + tints, edit sheet fields legible in both themes.

- [ ] **Step 5: Commit** — `style: warm history chips, day headers, edit sheet`

---

### Task 4: Stats restyle (charts + page)

**Files:**
- Modify: `src/components/BarChart.tsx`, `src/components/LineChart.tsx`, `src/app/stats/page.tsx`

- [ ] **Step 1: `src/components/BarChart.tsx`** — same props `{data, color?}`; bars `rounded-t-md`, default color `bg-growth`; value label `text-[11px] font-semibold tabular-nums text-ink-soft`; day label `text-[11px] text-ink-soft`; container height stays `h-36`, gap `gap-1.5`, bar max height 75%.

- [ ] **Step 2: `src/components/LineChart.tsx`** — same props; line/dots via CSS vars so they theme: `<path style={{ stroke: "var(--growth-accent)" }} strokeWidth={2.5} fill="none" …/>`, dots `<circle r={4} style={{ fill: "var(--growth-accent)" }} …/>`, all `<text>` `style={{ fill: "var(--ink-soft)" }}` fontSize 10.

- [ ] **Step 3: `src/app/stats/page.tsx`** — (data/form logic incl. local-date default, >0 guards, onSuccess clear — unchanged):
  - main SCREEN; title `text-2xl font-bold`
  - each section: CARD; header row `mb-3 flex items-center gap-2.5` with icon badge `flex h-9 w-9 items-center justify-center rounded-full text-lg <tint>` + title `text-base font-semibold text-ink`
    (sleep→😴/`bg-sleep-tint`, feeds & bottles→🍼/`bg-feed-tint`, diapers→🧷/`bg-diaper-tint`, pump→🥛/`bg-pump-tint`, growth & add-measurement→📏/`bg-growth-tint`)
  - BarChart colors: sleep `bg-sleep`, feeds `bg-feed`, bottles `bg-feed`, diapers `bg-diaper`, pump `bg-pump`
  - measurement form: visible labels (LABEL) above each input using existing keys `stats.date`, `stats.weightKg`, `stats.heightCm`, `stats.headCm` (keep placeholders removed), inputs INPUT, save PRIMARY_BTN
  - growth sub-labels `text-xs font-medium text-ink-soft`; needTwoPoints `text-sm text-ink-soft`

- [ ] **Step 4: Verify** — tests + tsc; dev: charts show accent colors in both themes (SVG line uses var()), labels readable.

- [ ] **Step 5: Commit** — `style: warm stats cards and accent-tokened charts`

---

### Task 5: Settings + Login restyle (+ login.subtitle)

**Files:**
- Modify: `src/app/settings/page.tsx`, `src/app/login/page.tsx`, `src/messages/fr.json`, `src/messages/en.json`

- [ ] **Step 1: Add mirrored key** — fr `"login": { …existing…, "subtitle": "Le petit journal de bébé" }`; en `"subtitle": "Your baby's little logbook"`.

- [ ] **Step 2: `src/app/settings/page.tsx`** — (logic incl. logout try/finally + success toast unchanged):
  - main SCREEN; title `text-2xl font-bold`
  - sections: CARD with header `mb-3 flex items-center gap-2.5` (icon badge `flex h-9 w-9 items-center justify-center rounded-full text-lg`: baby 👶 `bg-feed-tint`, caregiver 💛 `bg-medicine-tint`, language 🌍 `bg-growth-tint`) + title `text-base font-semibold text-ink`
  - inputs INPUT with LABEL labels (`settings.name`, `settings.birthDate`)
  - segmented buttons: SEG_ON / SEG_OFF
  - save PRIMARY_BTN; logout `min-h-[48px] w-full rounded-2xl bg-surface py-3.5 font-semibold text-danger shadow-sm`

- [ ] **Step 3: `src/app/login/page.tsx`** — (submit logic unchanged) layout: centered `main flex min-h-dvh items-center justify-center p-6` wrapping a card `w-full max-w-sm space-y-4 rounded-3xl bg-surface p-6 text-center shadow-sm`; icon `mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-feed-tint text-4xl`; title `text-3xl font-bold`; subtitle `text-sm text-ink-soft` = `{t("subtitle")}`; input INPUT + `min-h-[56px] text-center` + `autoComplete="current-password"`; error `rounded-2xl bg-danger/10 px-4 py-2.5 text-sm font-medium text-danger`; button PRIMARY_BTN + `min-h-[52px]`.

- [ ] **Step 4: Verify** — tests + tsc; dev: login card + settings cards legible both themes.

- [ ] **Step 5: Commit** — `style: warm settings and login screens`

---

### Task 6: Final verification (both themes, all screens)

**Files:** none new (fixes only if verification finds issues)

- [ ] **Step 1:** `npm run test` → 52 pass; `npx tsc --noEmit` clean; `npm run build` succeeds.
- [ ] **Step 2:** grep both catalogs mirrored: identical key sets (script or manual diff of sorted key paths).
- [ ] **Step 3:** Browser pass at 390px: Home (with a running timer + events), History (filtered + edit sheet open), Stats (charts + form), Settings, Login — screenshot each in light AND dark (emulate `prefers-color-scheme`). Check: no unreadable text, no clipped layouts, tap targets comfortable, charts colored by accent.
- [ ] **Step 4:** Fix anything found (presentation-only), re-run step 1.
- [ ] **Step 5:** Commit — `style: final polish after two-theme visual pass`

---

## ADDENDUM (2026-07-20) — applies to ALL tasks including 3-6

**Repo was restructured:** Next app now lives in `frontend/` (old `src/app/api/*` routes deleted; FastAPI backend in `backend/` serves the same contract through a Next rewrite). Every `src/...` path in Tasks 1-6 is now `frontend/src/...`. Frontend commands run from `frontend/` (`npm run test`, `npx tsc --noEmit`, `npm run build`). The frontend vitest suite now contains only the auth + format tests — "tests green" means those pass. Backend gate: `cd backend && python3 -m pytest` (15 pass; API suite auto-skips without BM_TEST_DATABASE_URL). Dev servers: `docker compose up db backend` (or backend via uvicorn with DATABASE_URL) + `cd frontend && npm run dev` (rewrite targets http://localhost:8000).

### Task 7: Layout mode infrastructure (Auto/Mobile/Web)

**Files:**
- Create: `frontend/src/hooks/useLayoutMode.tsx`, `frontend/src/components/TopBar.tsx`
- Modify: `frontend/src/app/providers.tsx` (wrap provider), `frontend/src/app/layout.tsx` (render TopBar above children), `frontend/src/components/BottomNav.tsx` (hide in web mode), `frontend/src/messages/fr.json` + `en.json` (`mode` group)

**Interfaces:**
- Produces `useLayoutMode(): { setting: "auto"|"mobile"|"web"; mode: "mobile"|"web"; setSetting(s): void }` and `LayoutModeProvider`.

- [ ] **Step 1: `frontend/src/hooks/useLayoutMode.tsx`**

```tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type LayoutSetting = "auto" | "mobile" | "web";
export type LayoutMode = "mobile" | "web";

const KEY = "bm_layout";
const QUERY = "(min-width: 768px)";

const Ctx = createContext<{
  setting: LayoutSetting;
  mode: LayoutMode;
  setSetting: (s: LayoutSetting) => void;
}>({ setting: "auto", mode: "mobile", setSetting: () => {} });

export function LayoutModeProvider({ children }: { children: React.ReactNode }) {
  const [setting, setSettingState] = useState<LayoutSetting>("auto");
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    if (stored === "mobile" || stored === "web" || stored === "auto") setSettingState(stored);
    const mq = window.matchMedia(QUERY);
    setWide(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setSetting = (s: LayoutSetting) => {
    setSettingState(s);
    localStorage.setItem(KEY, s);
  };

  const mode: LayoutMode = setting === "auto" ? (wide ? "web" : "mobile") : setting;
  return <Ctx.Provider value={{ setting, mode, setSetting }}>{children}</Ctx.Provider>;
}

export function useLayoutMode() {
  return useContext(Ctx);
}
```

- [ ] **Step 2: `frontend/src/components/TopBar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLayoutMode, LayoutSetting } from "@/hooks/useLayoutMode";

const settings: LayoutSetting[] = ["auto", "mobile", "web"];
const tabs = [
  { href: "/", key: "home" },
  { href: "/history", key: "history" },
  { href: "/stats", key: "stats" },
  { href: "/settings", key: "settings" },
] as const;

export default function TopBar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tm = useTranslations("mode");
  const { setting, mode, setSetting } = useLayoutMode();
  if (pathname === "/login") return null;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2 text-base font-bold">
          <span className="text-xl">🍼</span>
          <span>Baby Marks</span>
        </div>
        {mode === "web" && (
          <nav className="flex items-center gap-1">
            {tabs.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${pathname === tab.href ? "bg-primary/15 text-primary" : "text-ink-soft"}`}
              >
                {t(tab.key)}
              </Link>
            ))}
          </nav>
        )}
        <div className="flex items-center rounded-full bg-surface-2 p-1">
          {settings.map((s) => (
            <button
              key={s}
              onClick={() => setSetting(s)}
              className={`min-h-[36px] rounded-full px-3 text-xs font-semibold ${setting === s ? "bg-primary text-white" : "text-ink-soft"}`}
            >
              {tm(s)}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 3:** providers.tsx wraps children with `LayoutModeProvider` (inside QueryClientProvider). layout.tsx renders `<TopBar />` immediately before `{children}` (inside Providers/NextIntlClientProvider). BottomNav adds `const { mode } = useLayoutMode();` and returns null when `mode === "web"` (keep the /login check).
- [ ] **Step 4:** i18n `mode` group, both catalogs: fr `{ "auto": "Auto", "mobile": "Mobile", "web": "Web" }`, en identical.
- [ ] **Step 5:** Verify (frontend tests + tsc; dev: TopBar renders, switch persists after reload via localStorage, BottomNav hides in Web). Commit `feat: layout mode infrastructure with Auto/Mobile/Web switch`.

### Task 8: Web-mode layouts per screen

**Files:** Modify `frontend/src/app/page.tsx`, `history/page.tsx`, `stats/page.tsx`, `settings/page.tsx`

- [ ] **Step 1: Home** — `const { mode } = useLayoutMode();` Main wrapper: mobile keeps `space-y-6 p-5 pb-28`; web: `mx-auto max-w-5xl p-6 pb-10`. In web mode render `<div className="grid grid-cols-2 gap-6"><div className="space-y-6">{RunningTimers}{ActionGrid}</div><div className="space-y-6">{TimeSinceCards}{today section}</div></div>`; mobile order unchanged. (Extract the two column fragments into local variables to avoid duplicating JSX.)
- [ ] **Step 2: History & Settings** — wrapper `mx-auto max-w-2xl p-6 pb-10` in web mode (content unchanged). **Stats** — `mx-auto max-w-3xl p-6 pb-10`; in web mode wrap the five chart sections in `grid grid-cols-2 gap-4` with growth + add-measurement sections spanning `col-span-2`; mobile unchanged.
- [ ] **Step 3:** Verify (tests+tsc; dev at 1280px: two-column Home, centered pages; at 390px unchanged). Commit `feat: web-mode layouts (two-column home, centered pages)`.

### Task 9: TimeWheelPicker (wheels + quick chips)

**Files:**
- Create: `frontend/src/components/TimeWheelPicker.tsx`
- Modify: `frontend/src/components/EditEventSheet.tsx` (mobile-mode picker buttons), `frontend/src/messages/fr.json` + `en.json` (`picker` group)

**Interfaces:**
- `TimeWheelPicker({ open, title, value, allowClear?, onDone(d: Date), onClear?(), onClose })` — value: Date; onDone fires with the picked Date; onClear only rendered when allowClear.

- [ ] **Step 1: `frontend/src/components/TimeWheelPicker.tsx`** — bottom sheet reusing `Sheet`. Inside:
  - Day chips row: `picker.today` / `picker.yesterday` chips (`rounded-full px-4 py-2.5 text-sm font-semibold`, selected `bg-primary text-white`, else `bg-surface-2 text-ink-soft`) + a native `<input type="date">` (INPUT recipe, flex-1) for other days; selecting a chip/date keeps the wheel time.
  - Wheels: hour (0-23) and minute (0-59) columns side by side; each `h-[220px] overflow-y-auto snap-y snap-mandatory scrollbar: none` with `py-[88px]` spacer padding; items `flex h-11 snap-center items-center justify-center text-xl font-semibold tabular-nums text-ink-soft` (selected value `text-ink`); a pointer-events-none selection band `absolute inset-x-0 top-1/2 h-11 -translate-y-1/2 rounded-xl bg-primary/10`. On mount and when value changes scroll each wheel to the current index (`scrollTop = index * 44`); on scroll (debounced 120ms) compute `Math.round(scrollTop / 44)` and update.
  - Quick chips: `picker.now`, `−5 min`, `−15 min`, `−30 min` (relative to NOW, i.e. `new Date(Date.now() - m*60000)`) — style like day chips.
  - If `allowClear`: full-width chip `picker.noEnd` (`rounded-2xl bg-sleep-tint py-3 font-semibold text-sleep`) → `onClear()` + close.
  - Done: PRIMARY_BTN with `picker.done` → `onDone(current)` + close.
- [ ] **Step 2: EditEventSheet integration** — `const { mode } = useLayoutMode();` For `mode === "mobile"`: replace the two `datetime-local` inputs with buttons (INPUT recipe + `text-left`) showing the value formatted via `new Date(x).toLocaleString(locale fr-FR/en-GB, { weekday: "short", hour: "2-digit", minute: "2-digit" })` (end button shows `t("edit.running")` when empty); tapping opens TimeWheelPicker (`allowClear` on the end field; onClear sets end to ""). Web mode: existing inputs untouched. All save/guard logic unchanged (picker writes back through the same `setStart(toLocalInput(d))`/`setEnd(...)` state).
- [ ] **Step 3:** i18n `picker` group: fr `{ "today": "Aujourd'hui", "yesterday": "Hier", "now": "Maintenant", "done": "OK", "noEnd": "En cours (pas de fin)" }`; en `{ "today": "Today", "yesterday": "Yesterday", "now": "Now", "done": "Done", "noEnd": "Still running (no end)" }`.
- [ ] **Step 4:** Verify (tests+tsc; dev mobile mode: picker opens, wheels snap, chips set time, noEnd clears end, save produces same PATCH payloads as before). Commit `feat: wheel time picker with quick-adjust chips (mobile mode)`.

### Task 10: Migration hygiene (backend-split gaps)

**Files:** Modify `frontend/src/proxy.ts`, `README.md`, `.env.example`; Create `backend/.env.example`

- [ ] **Step 1:** proxy.ts — exempt health: after the `/api/auth/` exemption add `if (pathname === "/api/health") return NextResponse.next();`
- [ ] **Step 2:** Rewrite `README.md`: architecture (frontend Next 16 + backend FastAPI + Postgres 17), quick start `docker compose up --build` (app on :3000, api on :8000), local dev without docker (backend: `cd backend && pip install -r requirements.txt && DATABASE_URL=... uvicorn app.main:app --reload`; frontend: `cd frontend && npm install && npm run dev`), env vars table (`APP_SECRET_PHRASE` both services, `DATABASE_URL`, `COOKIE_SECURE=true` behind HTTPS, `BACKEND_URL` = frontend BUILD-time arg — image rebuild required to change it), tests (`cd frontend && npm run test`; `cd backend && python3 -m pytest`, note `BM_TEST_DATABASE_URL` enables the API integration suite), note: no CORS middleware by design (same-origin via Next rewrite).
- [ ] **Step 3:** Root `.env.example` → just `APP_SECRET_PHRASE=change-me` + pointer comments to `backend/.env.example`; create `backend/.env.example` with `DATABASE_URL=postgresql://baby:baby@localhost:5432/baby_marks`, `APP_SECRET_PHRASE=change-me`, `COOKIE_SECURE=false`.
- [ ] **Step 4:** Verify (frontend tests+tsc; backend pytest 15 pass; dev: curl unauthenticated `http://localhost:3000/api/health` → 200 through the proxy). Commit `fix: unshadow /api/health; docs for FastAPI split`.

### Task 11: Final modes × themes verification

- [ ] **Step 1:** Gates: frontend tests + tsc + build; backend pytest.
- [ ] **Step 2:** Catalog mirror check (fr/en identical key sets).
- [ ] **Step 3:** Browser matrix: 390px (mobile mode) / 820px (web auto) / 1280px (web) × light + dark: Home, History (edit sheet + wheel picker open), Stats, Settings, Login. Check: no unreadable text/clipping, switch persists, two-column Home only in web mode, picker wheels usable.
- [ ] **Step 4:** Fix presentation-only issues found; re-run gates. Commit `style: final modes/themes polish`.
