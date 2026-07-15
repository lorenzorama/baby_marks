# Baby Marks — Design Spec

**Date:** 2026-07-15
**Status:** Approved by user

## Purpose

A mobile-first web app for two parents (maman/papa) to track one baby's daily rhythms from their phones: feedings, sleep, diapers, pumping, growth measurements, and medicine/vitamins. Optimized for one-handed, 3am use: big tap targets, dark-mode friendly, minimal typing.

## Scope (v1)

- Track: **feed** (breast left/right, bottle ml, solids), **sleep**, **diaper** (wet/dirty/both), **pump** (ml per side), **medicine** (name + dose), **growth** (weight/height/head circumference).
- Live start/stop timers for nursing, sleep, and pumping **plus** manual after-the-fact entry for everything.
- Timers are server-backed and sync across devices (both phones see a running timer).
- History with edit/delete (fixes "forgot to press stop").
- Basic stats: last-7-days sleep totals, feed counts/volumes, diaper counts; growth chart.
- FR/EN i18n, **French default**.
- One baby in the UI; schema supports more later.
- PWA manifest (installable to home screen). No offline mode in v1.

Out of scope for v1: multi-family accounts, offline sync, push notifications/reminders, photo attachments, data export.

## Stack

- **Next.js** (App Router) + TypeScript + Tailwind CSS.
- **Client-heavy architecture:** TanStack Query for fetching/mutations with optimistic updates; Next.js API route handlers as the backend.
- **Drizzle ORM** on **Vercel Postgres (Neon)**; local dev against a Neon branch or local Postgres via `DATABASE_URL`.
- **next-intl** for i18n (fr default, en secondary).
- **Zod** for API input validation (schemas shared client/server).
- Deployed on **Vercel**.

## Auth

- One shared secret (env var `APP_SECRET_PHRASE`). Login page posts it to `POST /api/auth/login`; on match, sets a signed, HTTP-only, long-lived (1 year) cookie.
- `middleware.ts` guards every page and API route: no valid cookie → redirect to `/login` (pages) or 401 JSON (API).
- No user accounts. Each entry carries a `caregiver` field (`maman` | `papa`) set by a toggle in the UI (persisted per device in localStorage).

## Data model

```
babies
  id          serial PK
  name        text
  birthDate   date
  createdAt   timestamptz

events
  id          serial PK
  babyId      FK -> babies
  type        enum: feed | sleep | diaper | pump | medicine
  startedAt   timestamptz        -- moment the activity started (or occurred, for point events)
  endedAt     timestamptz NULL   -- NULL = timer currently running
  details     jsonb              -- per-type payload, see below
  note        text NULL
  caregiver   enum: maman | papa
  createdAt   timestamptz
  updatedAt   timestamptz

measurements
  id           serial PK
  babyId       FK -> babies
  measuredAt   date
  weightG      int NULL          -- grams
  heightMm     int NULL          -- millimetres
  headCircMm   int NULL
  note         text NULL
  createdAt    timestamptz
```

### `details` payloads (validated by Zod per type)

- feed: `{ method: 'breast' | 'bottle' | 'solids', side?: 'left' | 'right', amountMl?: number, food?: string }`
- sleep: `{}` (duration derives from startedAt/endedAt)
- diaper: `{ kind: 'wet' | 'dirty' | 'both' }` — point event, `endedAt = startedAt`
- pump: `{ leftMl?: number, rightMl?: number }`
- medicine: `{ name: string, dose?: string }` — point event

### Timer semantics

- Starting a timer = `POST /api/events` with `endedAt: null`.
- Only one running event per (babyId, type) is allowed — enforced in the API (starting a new one returns 409 with the running event).
- Stopping = `PATCH` setting `endedAt`.
- A sleep spanning midnight is a single event; daily stats attribute the overlapping portion to each day.

## API

All under `/app/api/`, JSON, Zod-validated, cookie-authenticated.

- `POST /api/auth/login` — `{ secret }` → sets cookie.
- `POST /api/auth/logout` — clears cookie.
- `GET /api/events?type=&from=&to=&limit=` — newest first; also returns running timers.
- `POST /api/events` — create (running or completed).
- `PATCH /api/events/[id]` — edit any field (stop timer, fix times, change details).
- `DELETE /api/events/[id]`.
- `GET /api/measurements` / `POST /api/measurements` / `DELETE /api/measurements/[id]`.
- `GET /api/stats?days=7` — per-day aggregates: total sleep minutes, feed count, bottle ml total, breast minutes, diaper counts by kind, pump ml total.
- Baby bootstrap: on first load, if no baby exists, Settings prompts for name + birth date (`POST /api/baby`; `GET /api/baby`, `PATCH /api/baby`).

## Screens

Bottom tab navigation (mobile-first), four tabs:

1. **Home ("Now")**
   - Running timers pinned at top with live elapsed time and Stop button.
   - Grid of big action buttons: Nursing L / Nursing R (start timer), Bottle (quick form: ml), Sleep (start timer), Diaper (one-tap wet/dirty/both), Pump (start timer), Medicine (quick form), Solids (quick form).
   - "Time since" cards: last feed ended, last sleep ended, last diaper.
   - Today's timeline (compact list, newest first).
2. **History** — infinite day-by-day list, filter chips per type, tap entry → edit sheet (times, details, note, caregiver) or delete.
3. **Stats** — last-7-days bar charts (sleep h/day, feeds/day + ml/day, diapers/day) and growth line chart (weight/height over time) from measurements; "add measurement" form lives here.
4. **Settings** — baby profile (name, birth date), caregiver toggle (maman/papa), language (fr/en), logout.

## Error handling

- Mutations are optimistic (instant UI) with rollback + toast on failure.
- API errors: 400 (Zod details), 401 (unauthenticated), 404, 409 (timer already running — client offers to stop-and-restart).
- React Query retries reads, not writes.

## Testing

- **Vitest** unit tests for: stat aggregation (incl. sleep spanning midnight), Zod event schemas per type, timer-conflict logic, duration formatting.
- API route handler tests for events CRUD happy paths + 401/409.
- No E2E in v1.

## Decisions log

- Audience: single family, two parents, shared data. (user)
- Track all six categories in v1. (user)
- Timers **and** manual entry. (user)
- Vercel + Vercel Postgres. (user)
- Shared secret + cookie auth, no accounts. (user)
- Client-heavy: TanStack Query + API routes. (user)
- i18n fr/en in v1, French default. (user — revised from earlier "English only")
