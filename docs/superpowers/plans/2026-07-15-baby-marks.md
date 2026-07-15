# Baby Marks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mobile-first Next.js app for two parents to track a baby's feedings, sleep, diapers, pumping, medicine, and growth, with cross-device timers.

**Architecture:** Client-heavy Next.js App Router app: TanStack Query on the client talking to Next.js API route handlers, Drizzle ORM over Postgres (PGlite locally, Vercel Postgres/Neon in prod). Shared-secret cookie auth via middleware. next-intl for FR/EN (French default). A running timer is an `events` row with `endedAt = NULL`, so timers sync between phones.

**Tech Stack:** Next.js 15 (App Router, TypeScript, Tailwind 4), @tanstack/react-query v5, drizzle-orm + drizzle-kit, pg, @electric-sql/pglite (dev/test DB), zod, next-intl, vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-baby-marks-design.md`

## Global Constraints

- Project root is `/Users/lorenzo/Desktop/Projects /baby_marks` — the path contains a space; ALWAYS quote it in shell commands.
- Package manager: `npm`. Node 20+.
- All timestamps stored UTC (`timestamptz`); dates (birth, measurements) as `date` strings `YYYY-MM-DD`.
- Default locale `fr`, secondary `en`. Locale picked by `NEXT_LOCALE` cookie, no locale URL prefix.
- Auth cookie name: `bm_auth`. Env vars: `DATABASE_URL`, `APP_SECRET_PHRASE`.
- `src/lib/auth.ts` must stay edge-safe (Web Crypto only, no Node/db imports) — it is imported by `middleware.ts`.
- Local dev + tests use PGlite via `DATABASE_URL=pglite://<dir>` (or `pglite://memory`); prod uses a normal Postgres URL.
- Timer types (can have `endedAt = null`): `feed`, `sleep`, `pump`. Point types (`endedAt` required): `diaper`, `medicine`.
- Commit after every task. Test command: `npm run test` (vitest run).

---

### Task 1: Scaffold Next.js app + tooling

**Files:**
- Create: entire Next.js scaffold (create-next-app), `vitest.config.ts`, `src/test/setup.ts`
- Modify: `next.config.ts`, `package.json` (scripts), `.gitignore`

**Interfaces:**
- Produces: `@/*` path alias to `src/*`; `npm run test` runs vitest; dev server via `npm run dev`.

- [ ] **Step 1: Scaffold (move non-scaffold dirs aside first — create-next-app refuses unknown files)**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks"
mv docs /tmp/bm-docs-tmp && mv .claude /tmp/bm-claude-tmp 2>/dev/null; true
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --turbopack --yes
mv /tmp/bm-docs-tmp docs && mv /tmp/bm-claude-tmp .claude 2>/dev/null; true
```

Expected: scaffold succeeds; `src/app/page.tsx` exists; `docs/` restored.

- [ ] **Step 2: Install dependencies**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks"
npm install drizzle-orm pg zod @tanstack/react-query next-intl
npm install -D drizzle-kit @electric-sql/pglite vitest @types/pg
```

- [ ] **Step 3: Replace `next.config.ts`**

```ts
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  eslint: { ignoreDuringBuilds: true },
};

export default withNextIntl(nextConfig);
```

(`ignoreDuringBuilds`: v1 pragmatism — `details` payloads are loosely typed and the default ruleset blocks builds on `any`. Vitest still gates logic.)

- [ ] **Step 4: Create `vitest.config.ts` (project root)**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: { environment: "node", setupFiles: ["./src/test/setup.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
```

- [ ] **Step 5: Create `src/test/setup.ts`**

```ts
process.env.DATABASE_URL = "pglite://memory";
process.env.APP_SECRET_PHRASE = "test-secret";
```

- [ ] **Step 6: Add scripts to `package.json`** (merge into existing `scripts`)

```json
{
  "test": "vitest run",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:push": "drizzle-kit push"
}
```

- [ ] **Step 7: Append to `.gitignore`**

```
.pglite/
```

- [ ] **Step 8: Verify**

Run: `npm run test` → Expected: "No test files found" exit 0 (or pass `--passWithNoTests` if vitest exits 1: change script to `vitest run --passWithNoTests`).
Run: `npm run dev` briefly → Expected: compiles, serves default page on :3000. Stop it.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js app with vitest, drizzle, react-query, next-intl deps"
```

---

### Task 2: DB schema, migrations, db client

**Files:**
- Create: `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts`, `drizzle/` (generated), `src/db/__tests__/schema.test.ts`, `.env.local`

**Interfaces:**
- Produces: `getDb(): Promise<Db>` from `@/db`; tables `babies`, `events`, `measurements` from `@/db/schema`; enums `eventTypeEnum` (`feed|sleep|diaper|pump|medicine`), `caregiverEnum` (`maman|papa`).
- `events` columns: `id, babyId, type, startedAt (Date), endedAt (Date|null), details (jsonb), note, caregiver, createdAt, updatedAt`.
- `measurements` columns: `id, babyId, measuredAt (string date), weightG, heightMm, headCircMm, note, createdAt`.

- [ ] **Step 1: Create `src/db/schema.ts`**

```ts
import {
  pgTable, pgEnum, serial, text, date, timestamp, integer, jsonb,
} from "drizzle-orm/pg-core";

export const eventTypeEnum = pgEnum("event_type", [
  "feed", "sleep", "diaper", "pump", "medicine",
]);
export const caregiverEnum = pgEnum("caregiver", ["maman", "papa"]);

export const babies = pgTable("babies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  birthDate: date("birth_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  babyId: integer("baby_id").notNull().references(() => babies.id),
  type: eventTypeEnum("type").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  details: jsonb("details").notNull().default({}),
  note: text("note"),
  caregiver: caregiverEnum("caregiver").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const measurements = pgTable("measurements", {
  id: serial("id").primaryKey(),
  babyId: integer("baby_id").notNull().references(() => babies.id),
  measuredAt: date("measured_at").notNull(),
  weightG: integer("weight_g"),
  heightMm: integer("height_mm"),
  headCircMm: integer("head_circ_mm"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Create `drizzle.config.ts` (project root)**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://unused" },
});
```

- [ ] **Step 3: Generate the initial migration**

Run: `npx drizzle-kit generate --name init`
Expected: creates `drizzle/0000_init.sql` (contains `CREATE TYPE "public"."event_type"`, `CREATE TABLE "babies"` etc.) and `drizzle/meta/`.

- [ ] **Step 4: Create `src/db/index.ts`**

```ts
import { drizzle as drizzleNodePg, NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite, PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "path";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __bmDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!globalForDb.__bmDb) globalForDb.__bmDb = init();
  return globalForDb.__bmDb;
}

async function init(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (url.startsWith("pglite://")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const target = url.slice("pglite://".length);
    const client = target === "memory" ? new PGlite() : new PGlite(target);
    const db = drizzlePglite(client, { schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    return db;
  }
  const { Pool } = await import("pg");
  return drizzleNodePg(new Pool({ connectionString: url }), { schema });
}
```

- [ ] **Step 5: Create `.env.local` (NOT committed — already gitignored by scaffold)**

```
DATABASE_URL=pglite://.pglite/dev
APP_SECRET_PHRASE=bonjour-bebe
```

- [ ] **Step 6: Write smoke test `src/db/__tests__/schema.test.ts`**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "@/db";
import { babies, events } from "@/db/schema";

describe("db schema", () => {
  beforeAll(async () => { await getDb(); });

  it("round-trips a baby and an event", async () => {
    const db = await getDb();
    const [baby] = await db.insert(babies)
      .values({ name: "Test", birthDate: "2026-06-01" }).returning();
    expect(baby.id).toBeGreaterThan(0);

    const started = new Date("2026-07-15T10:00:00Z");
    const [ev] = await db.insert(events).values({
      babyId: baby.id, type: "sleep", startedAt: started, endedAt: null,
      details: {}, caregiver: "maman",
    }).returning();
    expect(ev.endedAt).toBeNull();
    expect(ev.startedAt.toISOString()).toBe(started.toISOString());
    expect(ev.details).toEqual({});
  });
});
```

- [ ] **Step 7: Run tests**

Run: `npm run test` → Expected: PASS (migration applies to in-memory PGlite, insert/select works).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: add drizzle schema, migrations, and pglite/pg db client"
```

---

### Task 3: Shared types + Zod validation schemas (TDD)

**Files:**
- Create: `src/lib/types.ts`, `src/lib/validation.ts`, `src/lib/__tests__/validation.test.ts`

**Interfaces:**
- Produces from `@/lib/types`: `EventType`, `Caregiver`, `ApiEvent`, `Baby`, `Measurement`, `CreateEventInput`.
- Produces from `@/lib/validation`: `createEventSchema` (parses `{type, startedAt, endedAt?, details?, note?, caregiver}`, coerces dates), `patchEventSchema`, `detailsByType` (record of per-type Zod schemas), `babySchema`, `measurementSchema`, `TIMER_TYPES: EventType[]`.

- [ ] **Step 1: Create `src/lib/types.ts`**

```ts
export type EventType = "feed" | "sleep" | "diaper" | "pump" | "medicine";
export type Caregiver = "maman" | "papa";

export type ApiEvent = {
  id: number;
  babyId: number;
  type: EventType;
  startedAt: string;          // ISO
  endedAt: string | null;     // ISO or null = running
  details: Record<string, unknown>;
  note: string | null;
  caregiver: Caregiver;
};

export type Baby = { id: number; name: string; birthDate: string };

export type Measurement = {
  id: number;
  babyId: number;
  measuredAt: string;
  weightG: number | null;
  heightMm: number | null;
  headCircMm: number | null;
  note: string | null;
};

export type CreateEventInput = {
  type: EventType;
  startedAt: string;
  endedAt?: string | null;
  details?: Record<string, unknown>;
  note?: string | null;
  caregiver: Caregiver;
};
```

- [ ] **Step 2: Write failing tests `src/lib/__tests__/validation.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createEventSchema, patchEventSchema, measurementSchema, babySchema } from "@/lib/validation";

const base = { caregiver: "maman", startedAt: "2026-07-15T10:00:00Z" };

describe("createEventSchema", () => {
  it("accepts a running breast feed", () => {
    const r = createEventSchema.safeParse({
      ...base, type: "feed", endedAt: null,
      details: { method: "breast", side: "left" },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.startedAt).toBeInstanceOf(Date);
      expect(r.data.endedAt).toBeNull();
    }
  });

  it("accepts a completed bottle with ml", () => {
    const r = createEventSchema.safeParse({
      ...base, type: "feed", endedAt: "2026-07-15T10:10:00Z",
      details: { method: "bottle", amountMl: 90 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects bottle with negative ml", () => {
    const r = createEventSchema.safeParse({
      ...base, type: "feed", endedAt: null,
      details: { method: "bottle", amountMl: -5 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects diaper without kind", () => {
    const r = createEventSchema.safeParse({
      ...base, type: "diaper", endedAt: base.startedAt, details: {},
    });
    expect(r.success).toBe(false);
  });

  it("rejects diaper without endedAt (point events need an end)", () => {
    const r = createEventSchema.safeParse({
      ...base, type: "diaper", endedAt: null, details: { kind: "wet" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects endedAt before startedAt", () => {
    const r = createEventSchema.safeParse({
      ...base, type: "sleep", endedAt: "2026-07-15T09:00:00Z", details: {},
    });
    expect(r.success).toBe(false);
  });

  it("rejects medicine without name", () => {
    const r = createEventSchema.safeParse({
      ...base, type: "medicine", endedAt: base.startedAt, details: {},
    });
    expect(r.success).toBe(false);
  });
});

describe("patchEventSchema", () => {
  it("accepts a partial patch (stop timer)", () => {
    const r = patchEventSchema.safeParse({ endedAt: "2026-07-15T11:00:00Z" });
    expect(r.success).toBe(true);
  });
  it("accepts explicit null endedAt (restart timer)", () => {
    const r = patchEventSchema.safeParse({ endedAt: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.endedAt).toBeNull();
  });
});

describe("measurementSchema", () => {
  it("accepts weight-only measurement", () => {
    const r = measurementSchema.safeParse({ measuredAt: "2026-07-15", weightG: 4200 });
    expect(r.success).toBe(true);
  });
  it("rejects measurement with no values", () => {
    const r = measurementSchema.safeParse({ measuredAt: "2026-07-15" });
    expect(r.success).toBe(false);
  });
});

describe("babySchema", () => {
  it("accepts name + birthDate", () => {
    expect(babySchema.safeParse({ name: "Léo", birthDate: "2026-06-01" }).success).toBe(true);
  });
  it("rejects bad date", () => {
    expect(babySchema.safeParse({ name: "Léo", birthDate: "01/06/2026" }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm run test` → Expected: FAIL (cannot resolve `@/lib/validation`).

- [ ] **Step 4: Create `src/lib/validation.ts`**

```ts
import { z } from "zod";
import type { EventType } from "./types";

export const TIMER_TYPES: EventType[] = ["feed", "sleep", "pump"];
export const POINT_TYPES: EventType[] = ["diaper", "medicine"];

export const eventTypeSchema = z.enum(["feed", "sleep", "diaper", "pump", "medicine"]);
export const caregiverSchema = z.enum(["maman", "papa"]);

const feedDetails = z.object({
  method: z.enum(["breast", "bottle", "solids"]),
  side: z.enum(["left", "right"]).optional(),
  amountMl: z.number().int().positive().max(2000).optional(),
  food: z.string().max(200).optional(),
});
const sleepDetails = z.object({});
const diaperDetails = z.object({ kind: z.enum(["wet", "dirty", "both"]) });
const pumpDetails = z.object({
  leftMl: z.number().int().min(0).max(2000).optional(),
  rightMl: z.number().int().min(0).max(2000).optional(),
});
const medicineDetails = z.object({
  name: z.string().min(1).max(200),
  dose: z.string().max(100).optional(),
});

export const detailsByType: Record<EventType, z.ZodTypeAny> = {
  feed: feedDetails,
  sleep: sleepDetails,
  diaper: diaperDetails,
  pump: pumpDetails,
  medicine: medicineDetails,
};

export const createEventSchema = z
  .object({
    type: eventTypeSchema,
    startedAt: z.coerce.date(),
    endedAt: z.coerce.date().nullable().default(null),
    details: z.record(z.string(), z.unknown()).default({}),
    note: z.string().max(1000).nullable().optional(),
    caregiver: caregiverSchema,
  })
  .superRefine((val, ctx) => {
    const r = detailsByType[val.type].safeParse(val.details ?? {});
    if (!r.success) {
      ctx.addIssue({ code: "custom", path: ["details"], message: `invalid details for ${val.type}` });
    }
    if (val.endedAt && val.endedAt.getTime() < val.startedAt.getTime()) {
      ctx.addIssue({ code: "custom", path: ["endedAt"], message: "endedAt before startedAt" });
    }
    if (POINT_TYPES.includes(val.type) && val.endedAt === null) {
      ctx.addIssue({ code: "custom", path: ["endedAt"], message: `${val.type} requires endedAt` });
    }
  });

export const patchEventSchema = z.object({
  startedAt: z.coerce.date().optional(),
  endedAt: z.coerce.date().nullable().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  note: z.string().max(1000).nullable().optional(),
  caregiver: caregiverSchema.optional(),
});

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const babySchema = z.object({
  name: z.string().min(1).max(100),
  birthDate: dateString,
});

export const measurementSchema = z
  .object({
    measuredAt: dateString,
    weightG: z.number().int().positive().max(50000).optional(),
    heightMm: z.number().int().positive().max(2000).optional(),
    headCircMm: z.number().int().positive().max(1000).optional(),
    note: z.string().max(1000).nullable().optional(),
  })
  .refine((v) => v.weightG != null || v.heightMm != null || v.headCircMm != null, {
    message: "at least one measurement value required",
  });
```

Note: `patchEventSchema` distinguishes `endedAt: null` (set running) from absent (leave unchanged) — later code must check `=== undefined`, never `?? `.

- [ ] **Step 5: Run tests to verify pass**

Run: `npm run test` → Expected: all validation tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add shared types and zod validation schemas"
```

---

### Task 4: Auth (lib + login/logout API + middleware + login page)

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/__tests__/auth.test.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`, `src/middleware.ts`, `src/app/login/page.tsx`

**Interfaces:**
- Produces from `@/lib/auth`: `COOKIE_NAME = "bm_auth"`, `computeAuthToken(secret: string): Promise<string>` (64-char hex), `isAuthed(req: { cookies: { get(n: string): { value: string } | undefined } }): Promise<boolean>`.
- Every later API route calls `isAuthed(req)` and returns 401 JSON `{ error: "unauthenticated" }` when false.

- [ ] **Step 1: Write failing test `src/lib/__tests__/auth.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { computeAuthToken, isAuthed } from "@/lib/auth";

function fakeReq(cookie?: string) {
  return { cookies: { get: (_: string) => (cookie ? { value: cookie } : undefined) } };
}

describe("auth", () => {
  it("token is deterministic 64-char hex", async () => {
    const a = await computeAuthToken("s1");
    const b = await computeAuthToken("s1");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different secrets give different tokens", async () => {
    expect(await computeAuthToken("s1")).not.toBe(await computeAuthToken("s2"));
  });

  it("isAuthed true with valid cookie, false otherwise", async () => {
    const token = await computeAuthToken(process.env.APP_SECRET_PHRASE!);
    expect(await isAuthed(fakeReq(token))).toBe(true);
    expect(await isAuthed(fakeReq("wrong"))).toBe(false);
    expect(await isAuthed(fakeReq())).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test` → FAIL (module not found).

- [ ] **Step 3: Create `src/lib/auth.ts`** (edge-safe: Web Crypto only)

```ts
export const COOKIE_NAME = "bm_auth";

export async function computeAuthToken(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("baby-marks-auth-v1"));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type CookieReader = { cookies: { get(name: string): { value: string } | undefined } };

export async function isAuthed(req: CookieReader): Promise<boolean> {
  const secret = process.env.APP_SECRET_PHRASE;
  if (!secret) return false;
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (!cookie) return false;
  return cookie === (await computeAuthToken(secret));
}
```

- [ ] **Step 4: Run tests** — `npm run test` → PASS.

- [ ] **Step 5: Create `src/app/api/auth/login/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, computeAuthToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const secret = process.env.APP_SECRET_PHRASE;
  if (!secret) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.secret !== "string" || body.secret !== secret) {
    return NextResponse.json({ error: "invalid_secret" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, await computeAuthToken(secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return res;
}
```

- [ ] **Step 6: Create `src/app/api/auth/logout/route.ts`**

```ts
import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
```

- [ ] **Step 7: Create `src/middleware.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) return NextResponse.next();
  if (await isAuthed(req)) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|icon.svg|manifest.webmanifest).*)"],
};
```

- [ ] **Step 8: Create `src/app/login/page.tsx`** (plain text labels for now; i18n arrives in Task 8 — this page is revisited there)

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError(true);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 text-center">
        <div className="text-5xl">🍼</div>
        <h1 className="text-2xl font-bold">Baby Marks</h1>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Phrase secrète"
          autoFocus
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-center outline-none focus:border-sky-500"
        />
        {error && <p className="text-sm text-red-400">Phrase incorrecte</p>}
        <button
          type="submit"
          disabled={busy || secret.length === 0}
          className="w-full rounded-xl bg-sky-600 py-3 font-semibold disabled:opacity-50"
        >
          Entrer
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 9: Verify manually**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks" && npm run dev &
sleep 5
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/events        # expect 401
curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"secret":"bonjour-bebe"}' -c /tmp/bm-cookies.txt   # expect {"ok":true}
curl -s -o /dev/null -w "%{http_code}" -b /tmp/bm-cookies.txt http://localhost:3000/api/events  # expect 404 (route not built yet) NOT 401
kill %1
```

Expected codes as commented. (404 after auth proves middleware passes authed API requests through.)

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: shared-secret cookie auth with middleware and login page"
```

---

### Task 5: Events API (CRUD + timer conflict)

**Files:**
- Create: `src/app/api/events/route.ts`, `src/app/api/events/[id]/route.ts`, `src/test/helpers.ts`, `src/app/api/events/__tests__/events.test.ts`

**Interfaces:**
- Consumes: `getDb`, schema tables, `isAuthed`, `createEventSchema`, `patchEventSchema`, `detailsByType`, `TIMER_TYPES`.
- Produces HTTP API:
  - `GET /api/events?type=&from=&to=&before=&limit=` → `{ events: ApiEvent[], running: ApiEvent[] }` (newest first, limit default 100 max 500)
  - `POST /api/events` → 201 `{ event }` | 400 `{ error: "invalid" | "no_baby" }` | 409 `{ error: "timer_running", event }`
  - `PATCH /api/events/:id` → `{ event }` | 400 | 404
  - `DELETE /api/events/:id` → `{ ok: true }` | 404
- Produces test helpers from `@/test/helpers`: `resetDb()`, `seedBaby(name?)`, `authedRequest(url, init?)`, `unauthedRequest(url, init?)`.

- [ ] **Step 1: Create `src/test/helpers.ts`**

```ts
import { NextRequest } from "next/server";
import { COOKIE_NAME, computeAuthToken } from "@/lib/auth";
import { getDb } from "@/db";
import { babies, events, measurements } from "@/db/schema";

export async function resetDb() {
  const db = await getDb();
  await db.delete(events);
  await db.delete(measurements);
  await db.delete(babies);
}

export async function seedBaby(name = "Test") {
  const db = await getDb();
  const [baby] = await db.insert(babies).values({ name, birthDate: "2026-06-01" }).returning();
  return baby;
}

function buildRequest(url: string, init: RequestInit | undefined, cookie?: string) {
  const headers = new Headers(init?.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init?.body) headers.set("content-type", "application/json");
  return new NextRequest(new URL(url, "http://localhost:3000"), { ...init, headers } as RequestInit);
}

export async function authedRequest(url: string, init?: RequestInit) {
  const token = await computeAuthToken(process.env.APP_SECRET_PHRASE!);
  return buildRequest(url, init, `${COOKIE_NAME}=${token}`);
}

export function unauthedRequest(url: string, init?: RequestInit) {
  return buildRequest(url, init);
}
```

- [ ] **Step 2: Write failing tests `src/app/api/events/__tests__/events.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/events/route";
import { PATCH, DELETE } from "@/app/api/events/[id]/route";
import { resetDb, seedBaby, authedRequest, unauthedRequest } from "@/test/helpers";

const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

function post(body: unknown, authed = true) {
  const init = { method: "POST", body: JSON.stringify(body) };
  return authed ? authedRequest("/api/events", init) : Promise.resolve(unauthedRequest("/api/events", init));
}

describe("events API", () => {
  beforeEach(async () => { await resetDb(); });

  it("rejects unauthenticated requests", async () => {
    const res = await GET(unauthedRequest("/api/events"));
    expect(res.status).toBe(401);
  });

  it("returns 400 no_baby when no baby exists", async () => {
    const res = await POST(await post({
      type: "sleep", startedAt: new Date().toISOString(), endedAt: null,
      details: {}, caregiver: "maman",
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("no_baby");
  });

  it("creates and lists a completed diaper event", async () => {
    await seedBaby();
    const now = new Date().toISOString();
    const created = await POST(await post({
      type: "diaper", startedAt: now, endedAt: now,
      details: { kind: "both" }, caregiver: "papa",
    }));
    expect(created.status).toBe(201);

    const listRes = await GET(await authedRequest("/api/events"));
    const list = await listRes.json();
    expect(list.events).toHaveLength(1);
    expect(list.events[0].details.kind).toBe("both");
    expect(list.running).toHaveLength(0);
  });

  it("409s when starting a second timer of the same type", async () => {
    await seedBaby();
    const body = {
      type: "sleep", startedAt: new Date().toISOString(), endedAt: null,
      details: {}, caregiver: "maman",
    };
    expect((await POST(await post(body))).status).toBe(201);
    const dup = await POST(await post(body));
    expect(dup.status).toBe(409);
    const json = await dup.json();
    expect(json.error).toBe("timer_running");
    expect(json.event.type).toBe("sleep");
  });

  it("stops a timer via PATCH and validates details on PATCH", async () => {
    await seedBaby();
    const created = await POST(await post({
      type: "feed", startedAt: "2026-07-15T02:00:00Z", endedAt: null,
      details: { method: "breast", side: "left" }, caregiver: "maman",
    }));
    const { event } = await created.json();

    const stopped = await PATCH(await authedRequest(`/api/events/${event.id}`, {
      method: "PATCH", body: JSON.stringify({ endedAt: "2026-07-15T02:25:00Z" }),
    }), ctx(event.id));
    expect(stopped.status).toBe(200);
    expect((await stopped.json()).event.endedAt).toBe("2026-07-15T02:25:00.000Z");

    const bad = await PATCH(await authedRequest(`/api/events/${event.id}`, {
      method: "PATCH", body: JSON.stringify({ details: { method: "nope" } }),
    }), ctx(event.id));
    expect(bad.status).toBe(400);
  });

  it("deletes an event, then 404s", async () => {
    await seedBaby();
    const created = await POST(await post({
      type: "medicine", startedAt: "2026-07-15T08:00:00Z", endedAt: "2026-07-15T08:00:00Z",
      details: { name: "Vitamine D" }, caregiver: "papa",
    }));
    const { event } = await created.json();

    const del = await DELETE(await authedRequest(`/api/events/${event.id}`, { method: "DELETE" }), ctx(event.id));
    expect(del.status).toBe(200);
    const again = await DELETE(await authedRequest(`/api/events/${event.id}`, { method: "DELETE" }), ctx(event.id));
    expect(again.status).toBe(404);
  });

  it("filters by type", async () => {
    await seedBaby();
    const now = new Date().toISOString();
    await POST(await post({ type: "diaper", startedAt: now, endedAt: now, details: { kind: "wet" }, caregiver: "maman" }));
    await POST(await post({ type: "sleep", startedAt: now, endedAt: now, details: {}, caregiver: "maman" }));
    const res = await GET(await authedRequest("/api/events?type=diaper"));
    const json = await res.json();
    expect(json.events).toHaveLength(1);
    expect(json.events[0].type).toBe("diaper");
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npm run test` → FAIL (routes not found).

- [ ] **Step 4: Create `src/app/api/events/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, isNull, lt, lte, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { babies, events } from "@/db/schema";
import { isAuthed } from "@/lib/auth";
import { createEventSchema, TIMER_TYPES } from "@/lib/validation";
import type { EventType } from "@/lib/types";

const unauthorized = () => NextResponse.json({ error: "unauthenticated" }, { status: 401 });

export async function GET(req: NextRequest) {
  if (!(await isAuthed(req))) return unauthorized();
  const db = await getDb();
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 100, 1), 500);

  const conds: SQL[] = [];
  const type = sp.get("type");
  if (type) conds.push(eq(events.type, type as EventType));
  const from = sp.get("from");
  if (from) conds.push(gte(events.startedAt, new Date(from)));
  const to = sp.get("to");
  if (to) conds.push(lte(events.startedAt, new Date(to)));
  const before = sp.get("before");
  if (before) conds.push(lt(events.startedAt, new Date(before)));

  const rows = await db.select().from(events)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(events.startedAt))
    .limit(limit);
  const running = await db.select().from(events)
    .where(isNull(events.endedAt))
    .orderBy(desc(events.startedAt));
  return NextResponse.json({ events: rows, running });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed(req))) return unauthorized();
  const db = await getDb();
  const body = await req.json().catch(() => null);
  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", details: parsed.error.flatten() }, { status: 400 });
  }
  const [baby] = await db.select().from(babies).limit(1);
  if (!baby) return NextResponse.json({ error: "no_baby" }, { status: 400 });

  const data = parsed.data;
  if (data.endedAt === null && TIMER_TYPES.includes(data.type)) {
    const [running] = await db.select().from(events)
      .where(and(eq(events.type, data.type), isNull(events.endedAt)));
    if (running) {
      return NextResponse.json({ error: "timer_running", event: running }, { status: 409 });
    }
  }

  const [row] = await db.insert(events).values({
    babyId: baby.id,
    type: data.type,
    startedAt: data.startedAt,
    endedAt: data.endedAt,
    details: data.details,
    note: data.note ?? null,
    caregiver: data.caregiver,
  }).returning();
  return NextResponse.json({ event: row }, { status: 201 });
}
```

- [ ] **Step 5: Create `src/app/api/events/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { events } from "@/db/schema";
import { isAuthed } from "@/lib/auth";
import { detailsByType, patchEventSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

const unauthorized = () => NextResponse.json({ error: "unauthenticated" }, { status: 401 });
const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!(await isAuthed(req))) return unauthorized();
  const { id } = await ctx.params;
  const eventId = Number(id);
  if (!Number.isInteger(eventId)) return notFound();

  const body = await req.json().catch(() => null);
  const parsed = patchEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", details: parsed.error.flatten() }, { status: 400 });
  }

  const db = await getDb();
  const [existing] = await db.select().from(events).where(eq(events.id, eventId));
  if (!existing) return notFound();

  const d = parsed.data;
  const merged = {
    startedAt: d.startedAt ?? existing.startedAt,
    endedAt: d.endedAt === undefined ? existing.endedAt : d.endedAt,
    details: d.details === undefined ? (existing.details as Record<string, unknown>) : d.details,
    note: d.note === undefined ? existing.note : d.note,
    caregiver: d.caregiver ?? existing.caregiver,
  };

  const check = detailsByType[existing.type].safeParse(merged.details ?? {});
  if (!check.success) {
    return NextResponse.json({ error: "invalid", details: check.error.flatten() }, { status: 400 });
  }
  if (merged.endedAt && merged.endedAt.getTime() < merged.startedAt.getTime()) {
    return NextResponse.json({ error: "invalid", message: "endedAt before startedAt" }, { status: 400 });
  }

  const [row] = await db.update(events)
    .set({ ...merged, updatedAt: new Date() })
    .where(eq(events.id, eventId))
    .returning();
  return NextResponse.json({ event: row });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (!(await isAuthed(req))) return unauthorized();
  const { id } = await ctx.params;
  const eventId = Number(id);
  if (!Number.isInteger(eventId)) return notFound();

  const db = await getDb();
  const deleted = await db.delete(events).where(eq(events.id, eventId)).returning();
  if (deleted.length === 0) return notFound();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Run tests** — `npm run test` → all events tests PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: events CRUD API with running-timer conflict handling"
```

---

### Task 6: Baby + Measurements APIs

**Files:**
- Create: `src/app/api/baby/route.ts`, `src/app/api/measurements/route.ts`, `src/app/api/measurements/[id]/route.ts`, `src/app/api/baby/__tests__/baby.test.ts`, `src/app/api/measurements/__tests__/measurements.test.ts`

**Interfaces:**
- Produces HTTP API:
  - `GET /api/baby` → `{ baby: Baby | null }`; `POST /api/baby` → 201 `{ baby }` (409 if one exists); `PATCH /api/baby` → `{ baby }` (404 if none)
  - `GET /api/measurements` → `{ measurements: Measurement[] }` ascending by date; `POST` → 201 `{ measurement }` (400 no_baby / invalid); `DELETE /api/measurements/:id` → `{ ok: true }` | 404

- [ ] **Step 1: Write failing tests**

`src/app/api/baby/__tests__/baby.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { GET, POST, PATCH } from "@/app/api/baby/route";
import { resetDb, authedRequest, unauthedRequest } from "@/test/helpers";

describe("baby API", () => {
  beforeEach(async () => { await resetDb(); });

  it("401s unauthenticated", async () => {
    expect((await GET(unauthedRequest("/api/baby"))).status).toBe(401);
  });

  it("returns null baby, then creates, then 409s on second create", async () => {
    const empty = await (await GET(await authedRequest("/api/baby"))).json();
    expect(empty.baby).toBeNull();

    const created = await POST(await authedRequest("/api/baby", {
      method: "POST", body: JSON.stringify({ name: "Léo", birthDate: "2026-06-01" }),
    }));
    expect(created.status).toBe(201);

    const dup = await POST(await authedRequest("/api/baby", {
      method: "POST", body: JSON.stringify({ name: "Zoé", birthDate: "2026-06-02" }),
    }));
    expect(dup.status).toBe(409);
  });

  it("PATCH updates the baby", async () => {
    await POST(await authedRequest("/api/baby", {
      method: "POST", body: JSON.stringify({ name: "Léo", birthDate: "2026-06-01" }),
    }));
    const patched = await PATCH(await authedRequest("/api/baby", {
      method: "PATCH", body: JSON.stringify({ name: "Léon", birthDate: "2026-06-01" }),
    }));
    expect(patched.status).toBe(200);
    expect((await patched.json()).baby.name).toBe("Léon");
  });
});
```

`src/app/api/measurements/__tests__/measurements.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/measurements/route";
import { DELETE } from "@/app/api/measurements/[id]/route";
import { resetDb, seedBaby, authedRequest } from "@/test/helpers";

const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

describe("measurements API", () => {
  beforeEach(async () => { await resetDb(); });

  it("creates, lists ascending, deletes", async () => {
    await seedBaby();
    const postBody = (body: unknown) =>
      authedRequest("/api/measurements", { method: "POST", body: JSON.stringify(body) });
    const r2 = await POST(await postBody({ measuredAt: "2026-07-10", weightG: 4500 }));
    const r1 = await POST(await postBody({ measuredAt: "2026-07-01", weightG: 4200 }));
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    const list = await (await GET(await authedRequest("/api/measurements"))).json();
    expect(list.measurements.map((m: { weightG: number }) => m.weightG)).toEqual([4200, 4500]);

    const { measurement } = await r1.json();
    expect((await DELETE(await authedRequest(`/api/measurements/${measurement.id}`, { method: "DELETE" }), ctx(measurement.id))).status).toBe(200);
    expect((await DELETE(await authedRequest(`/api/measurements/${measurement.id}`, { method: "DELETE" }), ctx(measurement.id))).status).toBe(404);
  });

  it("400s with no values or no baby", async () => {
    const noBaby = await POST(await authedRequest("/api/measurements", {
      method: "POST", body: JSON.stringify({ measuredAt: "2026-07-01", weightG: 4000 }),
    }));
    expect(noBaby.status).toBe(400);

    await seedBaby();
    const noValues = await POST(await authedRequest("/api/measurements", {
      method: "POST", body: JSON.stringify({ measuredAt: "2026-07-01" }),
    }));
    expect(noValues.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test` → FAIL (modules not found).

- [ ] **Step 3: Create `src/app/api/baby/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { babies } from "@/db/schema";
import { isAuthed } from "@/lib/auth";
import { babySchema } from "@/lib/validation";

const unauthorized = () => NextResponse.json({ error: "unauthenticated" }, { status: 401 });

export async function GET(req: NextRequest) {
  if (!(await isAuthed(req))) return unauthorized();
  const db = await getDb();
  const [baby] = await db.select().from(babies).limit(1);
  return NextResponse.json({ baby: baby ?? null });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed(req))) return unauthorized();
  const db = await getDb();
  const parsed = babySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", details: parsed.error.flatten() }, { status: 400 });
  }
  const [existing] = await db.select().from(babies).limit(1);
  if (existing) return NextResponse.json({ error: "baby_exists" }, { status: 409 });
  const [baby] = await db.insert(babies).values(parsed.data).returning();
  return NextResponse.json({ baby }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  if (!(await isAuthed(req))) return unauthorized();
  const db = await getDb();
  const parsed = babySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", details: parsed.error.flatten() }, { status: 400 });
  }
  const [existing] = await db.select().from(babies).limit(1);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const [baby] = await db.update(babies).set(parsed.data).where(eq(babies.id, existing.id)).returning();
  return NextResponse.json({ baby });
}
```

- [ ] **Step 4: Create `src/app/api/measurements/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { getDb } from "@/db";
import { babies, measurements } from "@/db/schema";
import { isAuthed } from "@/lib/auth";
import { measurementSchema } from "@/lib/validation";

const unauthorized = () => NextResponse.json({ error: "unauthenticated" }, { status: 401 });

export async function GET(req: NextRequest) {
  if (!(await isAuthed(req))) return unauthorized();
  const db = await getDb();
  const rows = await db.select().from(measurements).orderBy(asc(measurements.measuredAt));
  return NextResponse.json({ measurements: rows });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed(req))) return unauthorized();
  const db = await getDb();
  const parsed = measurementSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", details: parsed.error.flatten() }, { status: 400 });
  }
  const [baby] = await db.select().from(babies).limit(1);
  if (!baby) return NextResponse.json({ error: "no_baby" }, { status: 400 });
  const [measurement] = await db.insert(measurements)
    .values({ ...parsed.data, babyId: baby.id }).returning();
  return NextResponse.json({ measurement }, { status: 201 });
}
```

- [ ] **Step 5: Create `src/app/api/measurements/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { measurements } from "@/db/schema";
import { isAuthed } from "@/lib/auth";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const mId = Number(id);
  if (!Number.isInteger(mId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const db = await getDb();
  const deleted = await db.delete(measurements).where(eq(measurements.id, mId)).returning();
  if (deleted.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Run tests** — `npm run test` → PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: baby profile and measurements APIs"
```

---

### Task 7: Stats aggregation (TDD) + stats API

**Files:**
- Create: `src/lib/stats.ts`, `src/lib/__tests__/stats.test.ts`, `src/app/api/stats/route.ts`

**Interfaces:**
- Produces from `@/lib/stats`:
  - `type DayStats = { date: string; sleepMinutes: number; breastMinutes: number; feedCount: number; bottleMl: number; diaperWet: number; diaperDirty: number; diaperBoth: number; pumpMl: number; medicineCount: number }`
  - `aggregateDaily(events: StatEvent[], days: number, tzOffsetMinutes: number, now: Date): DayStats[]` — oldest day first, `days` entries ending today. `tzOffsetMinutes` uses JS `Date.getTimezoneOffset()` semantics (UTC − local; Paris summer = −120).
  - `type StatEvent = { type: string; startedAt: Date; endedAt: Date | null; details: Record<string, unknown> }`
- Produces `GET /api/stats?days=7&tzOffset=-120` → `{ days: DayStats[] }`.

- [ ] **Step 1: Write failing tests `src/lib/__tests__/stats.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { aggregateDaily, StatEvent } from "@/lib/stats";

const now = new Date("2026-07-15T12:00:00Z");
const ev = (partial: Partial<StatEvent> & Pick<StatEvent, "type" | "startedAt">): StatEvent => ({
  endedAt: null, details: {}, ...partial,
});

describe("aggregateDaily", () => {
  it("returns `days` entries, oldest first, ending today", () => {
    const out = aggregateDaily([], 7, 0, now);
    expect(out).toHaveLength(7);
    expect(out[0].date).toBe("2026-07-09");
    expect(out[6].date).toBe("2026-07-15");
  });

  it("splits a sleep spanning midnight across both days (tz=0)", () => {
    const out = aggregateDaily([ev({
      type: "sleep",
      startedAt: new Date("2026-07-14T23:00:00Z"),
      endedAt: new Date("2026-07-15T01:30:00Z"),
    })], 7, 0, now);
    expect(out.find((d) => d.date === "2026-07-14")!.sleepMinutes).toBe(60);
    expect(out.find((d) => d.date === "2026-07-15")!.sleepMinutes).toBe(90);
  });

  it("buckets by local day using tzOffset (Paris summer, -120)", () => {
    // 23:30 Paris on Jul 14 = 21:30Z Jul 14 — must land on Jul 14, not Jul 15
    const out = aggregateDaily([ev({
      type: "diaper",
      startedAt: new Date("2026-07-14T21:30:00Z"),
      endedAt: new Date("2026-07-14T21:30:00Z"),
      details: { kind: "wet" },
    })], 7, -120, now);
    expect(out.find((d) => d.date === "2026-07-14")!.diaperWet).toBe(1);
  });

  it("counts a running sleep up to now", () => {
    const out = aggregateDaily([ev({
      type: "sleep", startedAt: new Date("2026-07-15T11:00:00Z"),
    })], 7, 0, now);
    expect(out.find((d) => d.date === "2026-07-15")!.sleepMinutes).toBe(60);
  });

  it("sums feeds, bottles, breast minutes, pump ml, diapers, medicine", () => {
    const out = aggregateDaily([
      ev({ type: "feed", startedAt: new Date("2026-07-15T08:00:00Z"), endedAt: new Date("2026-07-15T08:20:00Z"), details: { method: "breast", side: "left" } }),
      ev({ type: "feed", startedAt: new Date("2026-07-15T10:00:00Z"), endedAt: new Date("2026-07-15T10:05:00Z"), details: { method: "bottle", amountMl: 90 } }),
      ev({ type: "pump", startedAt: new Date("2026-07-15T09:00:00Z"), endedAt: new Date("2026-07-15T09:15:00Z"), details: { leftMl: 60, rightMl: 40 } }),
      ev({ type: "diaper", startedAt: new Date("2026-07-15T07:00:00Z"), endedAt: new Date("2026-07-15T07:00:00Z"), details: { kind: "dirty" } }),
      ev({ type: "medicine", startedAt: new Date("2026-07-15T07:30:00Z"), endedAt: new Date("2026-07-15T07:30:00Z"), details: { name: "Vit D" } }),
    ], 1, 0, now);
    const d = out[0];
    expect(d.feedCount).toBe(2);
    expect(d.breastMinutes).toBe(20);
    expect(d.bottleMl).toBe(90);
    expect(d.pumpMl).toBe(100);
    expect(d.diaperDirty).toBe(1);
    expect(d.medicineCount).toBe(1);
  });

  it("ignores events outside the window", () => {
    const out = aggregateDaily([ev({
      type: "diaper", startedAt: new Date("2026-07-01T10:00:00Z"),
      endedAt: new Date("2026-07-01T10:00:00Z"), details: { kind: "wet" },
    })], 7, 0, now);
    expect(out.every((d) => d.diaperWet === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test` → FAIL.

- [ ] **Step 3: Create `src/lib/stats.ts`**

```ts
export type StatEvent = {
  type: string;
  startedAt: Date;
  endedAt: Date | null;
  details: Record<string, unknown>;
};

export type DayStats = {
  date: string;
  sleepMinutes: number;
  breastMinutes: number;
  feedCount: number;
  bottleMl: number;
  diaperWet: number;
  diaperDirty: number;
  diaperBoth: number;
  pumpMl: number;
  medicineCount: number;
};

const DAY_MS = 86_400_000;

function dayKey(d: Date, tzOffsetMinutes: number): string {
  return new Date(d.getTime() - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function emptyDay(date: string): DayStats {
  return {
    date, sleepMinutes: 0, breastMinutes: 0, feedCount: 0, bottleMl: 0,
    diaperWet: 0, diaperDirty: 0, diaperBoth: 0, pumpMl: 0, medicineCount: 0,
  };
}

/** End of the local day containing `d`, as a UTC instant. */
function nextLocalMidnight(d: Date, tzOffsetMinutes: number): Date {
  const local = new Date(d.getTime() - tzOffsetMinutes * 60_000);
  const midnightUtcOfNextLocalDay = Date.UTC(
    local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1,
  );
  return new Date(midnightUtcOfNextLocalDay + tzOffsetMinutes * 60_000);
}

export function aggregateDaily(
  eventsIn: StatEvent[], days: number, tzOffsetMinutes: number, now: Date,
): DayStats[] {
  const byDay = new Map<string, DayStats>();
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(new Date(now.getTime() - i * DAY_MS), tzOffsetMinutes);
    byDay.set(key, emptyDay(key));
  }

  for (const e of eventsIn) {
    // Durations (sleep + breast feeds) are spread across local days.
    const isBreast = e.type === "feed" && e.details?.method === "breast";
    if (e.type === "sleep" || isBreast) {
      const end = e.endedAt ?? now;
      let cursor = e.startedAt;
      while (cursor < end) {
        const boundary = nextLocalMidnight(cursor, tzOffsetMinutes);
        const sliceEnd = end < boundary ? end : boundary;
        const minutes = (sliceEnd.getTime() - cursor.getTime()) / 60_000;
        const day = byDay.get(dayKey(cursor, tzOffsetMinutes));
        if (day) {
          if (e.type === "sleep") day.sleepMinutes += minutes;
          else day.breastMinutes += minutes;
        }
        cursor = sliceEnd;
      }
    }

    // Counts/volumes attributed to the start day.
    const day = byDay.get(dayKey(e.startedAt, tzOffsetMinutes));
    if (!day) continue;
    const det = e.details ?? {};
    switch (e.type) {
      case "feed": {
        day.feedCount += 1;
        if (det.method === "bottle" && typeof det.amountMl === "number") day.bottleMl += det.amountMl;
        break;
      }
      case "diaper": {
        if (det.kind === "wet") day.diaperWet += 1;
        else if (det.kind === "dirty") day.diaperDirty += 1;
        else if (det.kind === "both") day.diaperBoth += 1;
        break;
      }
      case "pump": {
        const l = typeof det.leftMl === "number" ? det.leftMl : 0;
        const r = typeof det.rightMl === "number" ? det.rightMl : 0;
        day.pumpMl += l + r;
        break;
      }
      case "medicine": day.medicineCount += 1; break;
    }
  }

  const out = [...byDay.values()];
  for (const d of out) {
    d.sleepMinutes = Math.round(d.sleepMinutes);
    d.breastMinutes = Math.round(d.breastMinutes);
  }
  return out;
}
```

- [ ] **Step 4: Run tests** — `npm run test` → PASS.

- [ ] **Step 5: Create `src/app/api/stats/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { gte, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { events } from "@/db/schema";
import { isAuthed } from "@/lib/auth";
import { aggregateDaily } from "@/lib/stats";

export async function GET(req: NextRequest) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const days = Math.min(Math.max(Number(sp.get("days")) || 7, 1), 90);
  const tzOffset = Number(sp.get("tzOffset")) || 0;

  const db = await getDb();
  const now = new Date();
  const from = new Date(now.getTime() - (days + 1) * 86_400_000);
  const rows = await db.select().from(events)
    .where(or(gte(events.startedAt, from), isNull(events.endedAt)));

  return NextResponse.json({
    days: aggregateDaily(
      rows.map((r) => ({
        type: r.type, startedAt: r.startedAt, endedAt: r.endedAt,
        details: (r.details ?? {}) as Record<string, unknown>,
      })),
      days, tzOffset, now,
    ),
  });
}
```

- [ ] **Step 6: Run full suite** — `npm run test` → PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: daily stats aggregation with midnight-spanning sleep split"
```

---

### Task 8: i18n + app shell (layout, providers, nav, dark theme, messages)

**Files:**
- Create: `src/i18n/request.ts`, `src/messages/fr.json`, `src/messages/en.json`, `src/app/providers.tsx`, `src/components/BottomNav.tsx`, `src/components/Toast.tsx`
- Modify: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx` (placeholder), `src/app/login/page.tsx` (use translations)

**Interfaces:**
- Produces: `useTranslations()` works in all client components under the root layout; `toast(msg: string)` from `@/components/Toast`; bottom nav on all pages except `/login`.
- Message keys (both locales must contain the full set — see fr.json below; en.json mirrors it).

- [ ] **Step 1: Create `src/i18n/request.ts`**

```ts
import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = store.get("NEXT_LOCALE")?.value === "en" ? "en" : "fr";
  return { locale, messages: (await import(`../messages/${locale}.json`)).default };
});
```

- [ ] **Step 2: Create `src/messages/fr.json`**

```json
{
  "nav": { "home": "Accueil", "history": "Historique", "stats": "Stats", "settings": "Réglages" },
  "login": { "title": "Baby Marks", "placeholder": "Phrase secrète", "submit": "Entrer", "error": "Phrase incorrecte" },
  "onboarding": { "title": "Bienvenue !", "text": "Commencez par créer le profil de votre bébé.", "cta": "Créer le profil" },
  "actions": { "nursingLeft": "Sein G", "nursingRight": "Sein D", "bottle": "Biberon", "sleep": "Dodo", "diaper": "Couche", "pump": "Tire-lait", "medicine": "Médoc", "solids": "Solides" },
  "timer": { "stop": "Stop", "feed": "Tétée", "sleep": "Dodo", "pump": "Tire-lait", "alreadyRunning": "Un minuteur est déjà en cours pour cette activité" },
  "timeSince": { "lastFeed": "Dernier repas", "lastSleep": "Dernier dodo", "lastDiaper": "Dernière couche", "never": "—", "ago": "il y a {duration}" },
  "timeline": { "today": "Aujourd'hui", "empty": "Rien pour l'instant" },
  "sheets": { "save": "Enregistrer", "cancel": "Annuler", "amountMl": "Quantité (ml)", "food": "Aliment", "medName": "Nom", "medDose": "Dose (optionnel)" },
  "diaper": { "wet": "Pipi", "dirty": "Caca", "both": "Les deux" },
  "summary": { "breastLeft": "Sein gauche", "breastRight": "Sein droit", "breast": "Sein", "bottle": "Biberon {ml} ml", "solids": "Solides · {food}", "sleep": "Dodo", "diaperWet": "Couche · pipi", "diaperDirty": "Couche · caca", "diaperBoth": "Couche · pipi + caca", "pump": "Tire-lait {ml} ml", "medicine": "Médicament · {name}", "running": "en cours" },
  "history": { "title": "Historique", "all": "Tout", "empty": "Aucun événement", "loadMore": "Charger plus" },
  "edit": { "title": "Modifier", "start": "Début", "end": "Fin", "running": "En cours (pas de fin)", "note": "Note", "caregiver": "Qui ?", "save": "Enregistrer", "delete": "Supprimer", "confirmDelete": "Supprimer cet événement ?" },
  "caregiver": { "maman": "Maman", "papa": "Papa" },
  "stats": { "title": "Stats", "sleepPerDay": "Sommeil (h / jour)", "feedsPerDay": "Repas / jour", "bottleMlPerDay": "Biberons (ml / jour)", "diapersPerDay": "Couches / jour", "pumpMlPerDay": "Tire-lait (ml / jour)", "growth": "Croissance", "weight": "Poids (kg)", "height": "Taille (cm)", "needTwoPoints": "Ajoutez au moins deux mesures pour voir la courbe.", "addMeasurement": "Ajouter une mesure", "date": "Date", "weightKg": "Poids (kg)", "heightCm": "Taille (cm)", "headCm": "Périmètre crânien (cm)", "save": "Enregistrer" },
  "settings": { "title": "Réglages", "babySection": "Bébé", "name": "Prénom", "birthDate": "Date de naissance", "save": "Enregistrer", "saved": "Enregistré !", "caregiverSection": "Je suis…", "languageSection": "Langue", "logout": "Se déconnecter" },
  "common": { "error": "Une erreur est survenue" }
}
```

- [ ] **Step 3: Create `src/messages/en.json`** (same keys, English values)

```json
{
  "nav": { "home": "Home", "history": "History", "stats": "Stats", "settings": "Settings" },
  "login": { "title": "Baby Marks", "placeholder": "Secret phrase", "submit": "Enter", "error": "Wrong phrase" },
  "onboarding": { "title": "Welcome!", "text": "Start by creating your baby's profile.", "cta": "Create profile" },
  "actions": { "nursingLeft": "Left breast", "nursingRight": "Right breast", "bottle": "Bottle", "sleep": "Sleep", "diaper": "Diaper", "pump": "Pump", "medicine": "Medicine", "solids": "Solids" },
  "timer": { "stop": "Stop", "feed": "Nursing", "sleep": "Sleep", "pump": "Pumping", "alreadyRunning": "A timer is already running for this activity" },
  "timeSince": { "lastFeed": "Last feed", "lastSleep": "Last sleep", "lastDiaper": "Last diaper", "never": "—", "ago": "{duration} ago" },
  "timeline": { "today": "Today", "empty": "Nothing yet" },
  "sheets": { "save": "Save", "cancel": "Cancel", "amountMl": "Amount (ml)", "food": "Food", "medName": "Name", "medDose": "Dose (optional)" },
  "diaper": { "wet": "Wet", "dirty": "Dirty", "both": "Both" },
  "summary": { "breastLeft": "Left breast", "breastRight": "Right breast", "breast": "Breast", "bottle": "Bottle {ml} ml", "solids": "Solids · {food}", "sleep": "Sleep", "diaperWet": "Diaper · wet", "diaperDirty": "Diaper · dirty", "diaperBoth": "Diaper · wet + dirty", "pump": "Pump {ml} ml", "medicine": "Medicine · {name}", "running": "running" },
  "history": { "title": "History", "all": "All", "empty": "No events", "loadMore": "Load more" },
  "edit": { "title": "Edit", "start": "Start", "end": "End", "running": "Running (no end)", "note": "Note", "caregiver": "Who?", "save": "Save", "delete": "Delete", "confirmDelete": "Delete this event?" },
  "caregiver": { "maman": "Mom", "papa": "Dad" },
  "stats": { "title": "Stats", "sleepPerDay": "Sleep (h / day)", "feedsPerDay": "Feeds / day", "bottleMlPerDay": "Bottles (ml / day)", "diapersPerDay": "Diapers / day", "pumpMlPerDay": "Pump (ml / day)", "growth": "Growth", "weight": "Weight (kg)", "height": "Height (cm)", "needTwoPoints": "Add at least two measurements to see the curve.", "addMeasurement": "Add measurement", "date": "Date", "weightKg": "Weight (kg)", "heightCm": "Height (cm)", "headCm": "Head circumference (cm)", "save": "Save" },
  "settings": { "title": "Settings", "babySection": "Baby", "name": "Name", "birthDate": "Birth date", "save": "Save", "saved": "Saved!", "caregiverSection": "I am…", "languageSection": "Language", "logout": "Log out" },
  "common": { "error": "Something went wrong" }
}
```

- [ ] **Step 4: Replace `src/app/globals.css`**

```css
@import "tailwindcss";

html {
  color-scheme: dark;
}

body {
  background: #09090b;
  color: #fafafa;
  -webkit-tap-highlight-color: transparent;
}
```

- [ ] **Step 5: Create `src/app/providers.tsx`**

```tsx
"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({
      defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
    }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 6: Create `src/components/Toast.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

let listener: ((msg: string) => void) | null = null;

export function toast(msg: string) {
  listener?.(msg);
}

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    listener = (m) => {
      setMsg(m);
      clearTimeout(timeout);
      timeout = setTimeout(() => setMsg(null), 3000);
    };
    return () => { listener = null; };
  }, []);
  if (!msg) return null;
  return (
    <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
      {msg}
    </div>
  );
}
```

- [ ] **Step 7: Create `src/components/BottomNav.tsx`**

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
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-zinc-800 bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex flex-col items-center gap-0.5 py-2 text-xs ${active ? "text-sky-400" : "text-zinc-500"}`}
          >
            <span className="text-xl">{tab.icon}</span>
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 8: Replace `src/app/layout.tsx`**

```tsx
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import Providers from "./providers";
import BottomNav from "@/components/BottomNav";
import { Toaster } from "@/components/Toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "Baby Marks",
  description: "Baby feeding & sleep tracker",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <body className="antialiased">
        <NextIntlClientProvider messages={messages}>
          <Providers>
            {children}
            <BottomNav />
            <Toaster />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 9: Replace `src/app/page.tsx` with a placeholder** (real Home built in Task 10)

```tsx
"use client";

import { useTranslations } from "next-intl";

export default function HomePage() {
  const t = useTranslations("nav");
  return <main className="p-4 pb-24">{t("home")}</main>;
}
```

- [ ] **Step 10: Update `src/app/login/page.tsx` to use translations** — replace the three hardcoded strings:

Add `import { useTranslations } from "next-intl";` and `const t = useTranslations("login");` inside the component; replace `placeholder="Phrase secrète"` → `placeholder={t("placeholder")}`, `Phrase incorrecte` → `{t("error")}`, `Entrer` → `{t("submit")}`, and the `<h1>` text → `{t("title")}`.

- [ ] **Step 11: Verify**

Run `npm run dev`; open http://localhost:3000 → redirected to `/login` (French labels); log in with `bonjour-bebe` → home placeholder "Accueil" with bottom nav in French. `npm run test` still passes. Stop server.

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "feat: i18n (fr/en), dark app shell, bottom nav, toast"
```

---

### Task 9: API client, format helpers, data hooks

**Files:**
- Create: `src/lib/api-client.ts`, `src/lib/format.ts`, `src/lib/__tests__/format.test.ts`, `src/hooks/useEvents.ts`, `src/hooks/useBaby.ts`, `src/hooks/useMeasurements.ts`, `src/hooks/useStats.ts`, `src/hooks/useCaregiver.ts`, `src/hooks/useNow.ts`

**Interfaces:**
- Produces from `@/lib/api-client`: `api.get/post/patch/delete<T>(url, body?)`, `class ApiError extends Error { status: number; data?: unknown }`. 401 responses hard-redirect to `/login`.
- Produces from `@/lib/format`: `formatDuration(minutes: number): string` ("45 min", "2h05"), `formatClock(totalSeconds: number): string` ("1:23:45"), `toLocalInput(d: Date): string` / `fromLocalInput(s: string): Date` (datetime-local helpers), `formatTime(iso: string, locale: string): string` ("14:05").
- Produces hooks:
  - `useRecentEvents()` → query `['events','recent']`, `{ events, running }`, refetch 30 s
  - `useCreateEvent()`, `useUpdateEvent()` (`{ id, ...patch }`), `useDeleteEvent()` — optimistic on `['events','recent']`, rollback + `toast` on error, invalidate `['events']` & `['stats']` on settle
  - `useBaby()` → `Baby | null`; `useSaveBaby()` (POST if none, PATCH if exists)
  - `useMeasurements()`, `useCreateMeasurement()`, `useDeleteMeasurement()`
  - `useStats(days)` — passes `tzOffset = new Date().getTimezoneOffset()`
  - `useCaregiver(): [Caregiver, (c: Caregiver) => void]` (localStorage `bm_caregiver`, default `maman`)
  - `useNow(intervalMs)` → ticking `Date`

- [ ] **Step 1: Write failing tests `src/lib/__tests__/format.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { formatDuration, formatClock, toLocalInput, fromLocalInput } from "@/lib/format";

describe("format", () => {
  it("formatDuration", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1h00");
    expect(formatDuration(125)).toBe("2h05");
  });

  it("formatClock", () => {
    expect(formatClock(59)).toBe("0:00:59");
    expect(formatClock(83)).toBe("0:01:23");
    expect(formatClock(3665)).toBe("1:01:05");
  });

  it("local input round-trip", () => {
    const d = new Date(2026, 6, 15, 14, 5); // local time
    expect(toLocalInput(d)).toBe("2026-07-15T14:05");
    expect(fromLocalInput("2026-07-15T14:05").getTime()).toBe(d.getTime());
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test` → FAIL.

- [ ] **Step 3: Create `src/lib/format.ts`**

```ts
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, "0")}`;
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(s: string): Date {
  return new Date(s);
}

export function formatTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale === "fr" ? "fr-FR" : "en-GB", {
    hour: "2-digit", minute: "2-digit",
  });
}
```

- [ ] **Step 4: Run tests** — `npm run test` → PASS.

- [ ] **Step 5: Create `src/lib/api-client.ts`**

```ts
export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
  }
  if (!res.ok) {
    let data: unknown;
    try { data = await res.json(); } catch { /* ignore */ }
    const msg = (data as { error?: string })?.error ?? res.statusText;
    throw new ApiError(res.status, msg, data);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
};
```

- [ ] **Step 6: Create `src/hooks/useEvents.ts`**

```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { toast } from "@/components/Toast";
import type { ApiEvent, CreateEventInput } from "@/lib/types";

export type RecentData = { events: ApiEvent[]; running: ApiEvent[] };

const RECENT_KEY = ["events", "recent"] as const;

export function useRecentEvents() {
  return useQuery<RecentData>({
    queryKey: RECENT_KEY,
    queryFn: () => api.get<RecentData>("/api/events?limit=100"),
    refetchInterval: 30_000,
  });
}

export function useCreateEvent(onApiError?: (err: unknown) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInput) =>
      api.post<{ event: ApiEvent }>("/api/events", input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: RECENT_KEY });
      const prev = qc.getQueryData<RecentData>(RECENT_KEY);
      if (prev) {
        const temp: ApiEvent = {
          id: -Date.now(), babyId: 0, type: input.type,
          startedAt: input.startedAt, endedAt: input.endedAt ?? null,
          details: input.details ?? {}, note: input.note ?? null,
          caregiver: input.caregiver,
        };
        qc.setQueryData<RecentData>(RECENT_KEY, {
          events: [temp, ...prev.events],
          running: temp.endedAt === null ? [temp, ...prev.running] : prev.running,
        });
      }
      return { prev };
    },
    onError: (err, _input, ctxData) => {
      if (ctxData?.prev) qc.setQueryData(RECENT_KEY, ctxData.prev);
      if (onApiError) onApiError(err);
      else toast(err instanceof Error ? err.message : "error");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number } & Record<string, unknown>) =>
      api.patch<{ event: ApiEvent }>(`/api/events/${id}`, patch),
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: RECENT_KEY });
      const prev = qc.getQueryData<RecentData>(RECENT_KEY);
      if (prev) {
        const apply = (e: ApiEvent) => (e.id === id ? { ...e, ...patch } as ApiEvent : e);
        qc.setQueryData<RecentData>(RECENT_KEY, {
          events: prev.events.map(apply),
          running: prev.running.map(apply).filter((e) => e.endedAt === null),
        });
      }
      return { prev };
    },
    onError: (err, _v, ctxData) => {
      if (ctxData?.prev) qc.setQueryData(RECENT_KEY, ctxData.prev);
      toast(err instanceof Error ? err.message : "error");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/api/events/${id}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
```

- [ ] **Step 7: Create `src/hooks/useBaby.ts`**

```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Baby } from "@/lib/types";

export function useBaby() {
  return useQuery<Baby | null>({
    queryKey: ["baby"],
    queryFn: async () => (await api.get<{ baby: Baby | null }>("/api/baby")).baby,
    staleTime: 5 * 60_000,
  });
}

export function useSaveBaby() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; birthDate: string; exists: boolean }) => {
      const { exists, ...body } = input;
      return exists
        ? api.patch<{ baby: Baby }>("/api/baby", body)
        : api.post<{ baby: Baby }>("/api/baby", body);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["baby"] }),
  });
}
```

- [ ] **Step 8: Create `src/hooks/useMeasurements.ts`**

```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { toast } from "@/components/Toast";
import type { Measurement } from "@/lib/types";

export function useMeasurements() {
  return useQuery<Measurement[]>({
    queryKey: ["measurements"],
    queryFn: async () =>
      (await api.get<{ measurements: Measurement[] }>("/api/measurements")).measurements,
  });
}

export function useCreateMeasurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.post<{ measurement: Measurement }>("/api/measurements", input),
    onError: (err) => toast(err instanceof Error ? err.message : "error"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["measurements"] }),
  });
}

export function useDeleteMeasurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/api/measurements/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["measurements"] }),
  });
}
```

- [ ] **Step 9: Create `src/hooks/useStats.ts`**

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { DayStats } from "@/lib/stats";

export function useStats(days = 7) {
  const tzOffset = new Date().getTimezoneOffset();
  return useQuery<DayStats[]>({
    queryKey: ["stats", days, tzOffset],
    queryFn: async () =>
      (await api.get<{ days: DayStats[] }>(`/api/stats?days=${days}&tzOffset=${tzOffset}`)).days,
  });
}
```

- [ ] **Step 10: Create `src/hooks/useCaregiver.ts`**

```ts
"use client";

import { useEffect, useState } from "react";
import type { Caregiver } from "@/lib/types";

export function useCaregiver(): [Caregiver, (c: Caregiver) => void] {
  const [caregiver, setCaregiver] = useState<Caregiver>("maman");
  useEffect(() => {
    const stored = localStorage.getItem("bm_caregiver");
    if (stored === "papa" || stored === "maman") setCaregiver(stored);
  }, []);
  const update = (c: Caregiver) => {
    setCaregiver(c);
    localStorage.setItem("bm_caregiver", c);
  };
  return [caregiver, update];
}
```

- [ ] **Step 11: Create `src/hooks/useNow.ts`**

```ts
"use client";

import { useEffect, useState } from "react";

export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
```

- [ ] **Step 12: Verify** — `npm run test` PASS; `npx tsc --noEmit` → no errors.

- [ ] **Step 13: Commit**

```bash
git add -A && git commit -m "feat: api client, format helpers, react-query data hooks"
```

---

### Task 10: Home screen (timers, action grid, quick sheets, time-since, today timeline)

**Files:**
- Create: `src/components/Sheet.tsx`, `src/components/RunningTimers.tsx`, `src/components/ActionGrid.tsx`, `src/components/TimeSinceCards.tsx`, `src/components/EventItem.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: all Task 9 hooks, `formatClock/formatDuration/formatTime`, `toast`, message keys from Task 8.
- Produces: `Sheet({ open, onClose, title, children })`; `EventItem({ event, locale, onClick? })` (used again by History in Task 11); `summarize(event, t)` exported from `EventItem.tsx` where `t` is `useTranslations("summary")`'s function.

- [ ] **Step 1: Create `src/components/Sheet.tsx`**

```tsx
"use client";

export default function Sheet({
  open, onClose, title, children,
}: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/60" onClick={onClose}>
      <div
        className="w-full rounded-t-2xl border-t border-zinc-800 bg-zinc-900 p-4 pb-[calc(2rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/EventItem.tsx`**

```tsx
"use client";

import { formatDuration, formatTime } from "@/lib/format";
import type { ApiEvent } from "@/lib/types";

const icons: Record<string, string> = {
  feed: "🍼", sleep: "😴", diaper: "🧷", pump: "🥛", medicine: "💊",
};

type Tsum = (key: string, values?: Record<string, string | number>) => string;

export function summarize(e: ApiEvent, t: Tsum): string {
  const det = e.details as Record<string, unknown>;
  switch (e.type) {
    case "feed":
      if (det.method === "bottle") return t("bottle", { ml: (det.amountMl as number) ?? 0 });
      if (det.method === "solids") return t("solids", { food: (det.food as string) ?? "" });
      if (det.side === "left") return t("breastLeft");
      if (det.side === "right") return t("breastRight");
      return t("breast");
    case "sleep": return t("sleep");
    case "diaper":
      if (det.kind === "dirty") return t("diaperDirty");
      if (det.kind === "both") return t("diaperBoth");
      return t("diaperWet");
    case "pump": {
      const ml = ((det.leftMl as number) ?? 0) + ((det.rightMl as number) ?? 0);
      return t("pump", { ml });
    }
    case "medicine": return t("medicine", { name: (det.name as string) ?? "" });
    default: return e.type;
  }
}

export function durationOf(e: ApiEvent): number | null {
  if (!e.endedAt || e.endedAt === e.startedAt) return null;
  const min = (new Date(e.endedAt).getTime() - new Date(e.startedAt).getTime()) / 60_000;
  return min >= 1 ? min : null;
}

export default function EventItem({
  event, locale, summaryT, runningLabel, onClick,
}: {
  event: ApiEvent;
  locale: string;
  summaryT: Tsum;
  runningLabel: string;
  onClick?: () => void;
}) {
  const dur = durationOf(event);
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl bg-zinc-900 px-3 py-2.5 text-left active:bg-zinc-800"
    >
      <span className="text-xl">{icons[event.type]}</span>
      <span className="flex-1">
        <span className="block text-sm">{summarize(event, summaryT)}</span>
        <span className="block text-xs text-zinc-500">
          {formatTime(event.startedAt, locale)}
          {event.endedAt === null && ` · ${runningLabel}`}
          {dur !== null && ` · ${formatDuration(dur)}`}
        </span>
      </span>
      <span className="text-xs text-zinc-600">{event.caregiver === "maman" ? "M" : "P"}</span>
    </button>
  );
}
```

- [ ] **Step 3: Create `src/components/RunningTimers.tsx`**

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useNow } from "@/hooks/useNow";
import { useUpdateEvent } from "@/hooks/useEvents";
import { formatClock } from "@/lib/format";
import type { ApiEvent } from "@/lib/types";

const icons: Record<string, string> = { feed: "🍼", sleep: "😴", pump: "🥛" };

export default function RunningTimers({ running }: { running: ApiEvent[] }) {
  const t = useTranslations("timer");
  const now = useNow(1000);
  const update = useUpdateEvent();
  if (running.length === 0) return null;
  return (
    <div className="space-y-2">
      {running.map((e) => {
        const secs = (now.getTime() - new Date(e.startedAt).getTime()) / 1000;
        const label = e.type === "feed" ? t("feed") : e.type === "sleep" ? t("sleep") : t("pump");
        const side = (e.details as { side?: string }).side;
        return (
          <div key={e.id} className="flex items-center gap-3 rounded-2xl border border-sky-800 bg-sky-950/40 p-3">
            <span className="text-2xl">{icons[e.type] ?? "⏱"}</span>
            <div className="flex-1">
              <div className="text-sm font-medium">
                {label}{side ? ` · ${side === "left" ? "G" : "D"}` : ""}
              </div>
              <div className="font-mono text-2xl tabular-nums">{formatClock(secs)}</div>
            </div>
            <button
              onClick={() => update.mutate({ id: e.id, endedAt: new Date().toISOString() })}
              className="rounded-xl bg-sky-600 px-5 py-3 font-semibold active:bg-sky-700"
            >
              {t("stop")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Create `src/components/ActionGrid.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Sheet from "@/components/Sheet";
import { toast } from "@/components/Toast";
import { useCreateEvent } from "@/hooks/useEvents";
import { useCaregiver } from "@/hooks/useCaregiver";
import { ApiError } from "@/lib/api-client";
import type { CreateEventInput } from "@/lib/types";

type SheetKind = "bottle" | "diaper" | "medicine" | "solids" | null;

export default function ActionGrid() {
  const t = useTranslations();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [caregiver] = useCaregiver();
  const create = useCreateEvent((err) => {
    if (err instanceof ApiError && err.status === 409) toast(t("timer.alreadyRunning"));
    else toast(t("common.error"));
  });

  const [bottleMl, setBottleMl] = useState("90");
  const [medName, setMedName] = useState("");
  const [medDose, setMedDose] = useState("");
  const [food, setFood] = useState("");

  function submit(input: Omit<CreateEventInput, "caregiver">) {
    create.mutate({ ...input, caregiver });
    setSheet(null);
  }
  const nowIso = () => new Date().toISOString();
  const startTimer = (type: "feed" | "sleep" | "pump", details: Record<string, unknown> = {}) =>
    submit({ type, startedAt: nowIso(), endedAt: null, details });
  const point = (type: "diaper" | "medicine" | "feed", details: Record<string, unknown>) => {
    const iso = nowIso();
    submit({ type, startedAt: iso, endedAt: iso, details });
  };

  const btn = "flex flex-col items-center gap-1 rounded-2xl bg-zinc-900 py-4 active:bg-zinc-800";
  const input = "w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none focus:border-sky-500";
  const primary = "w-full rounded-xl bg-sky-600 py-3 font-semibold disabled:opacity-50";

  return (
    <>
      <div className="grid grid-cols-4 gap-2">
        <button className={btn} onClick={() => startTimer("feed", { method: "breast", side: "left" })}>
          <span className="text-2xl">🤱</span><span className="text-xs">{t("actions.nursingLeft")}</span>
        </button>
        <button className={btn} onClick={() => startTimer("feed", { method: "breast", side: "right" })}>
          <span className="text-2xl">🤱</span><span className="text-xs">{t("actions.nursingRight")}</span>
        </button>
        <button className={btn} onClick={() => setSheet("bottle")}>
          <span className="text-2xl">🍼</span><span className="text-xs">{t("actions.bottle")}</span>
        </button>
        <button className={btn} onClick={() => startTimer("sleep")}>
          <span className="text-2xl">😴</span><span className="text-xs">{t("actions.sleep")}</span>
        </button>
        <button className={btn} onClick={() => setSheet("diaper")}>
          <span className="text-2xl">🧷</span><span className="text-xs">{t("actions.diaper")}</span>
        </button>
        <button className={btn} onClick={() => startTimer("pump")}>
          <span className="text-2xl">🥛</span><span className="text-xs">{t("actions.pump")}</span>
        </button>
        <button className={btn} onClick={() => setSheet("medicine")}>
          <span className="text-2xl">💊</span><span className="text-xs">{t("actions.medicine")}</span>
        </button>
        <button className={btn} onClick={() => setSheet("solids")}>
          <span className="text-2xl">🥣</span><span className="text-xs">{t("actions.solids")}</span>
        </button>
      </div>

      <Sheet open={sheet === "bottle"} onClose={() => setSheet(null)} title={t("actions.bottle")}>
        <div className="space-y-3">
          <input type="number" inputMode="numeric" value={bottleMl}
            onChange={(e) => setBottleMl(e.target.value)} placeholder={t("sheets.amountMl")} className={input} />
          <button className={primary} disabled={!Number(bottleMl)}
            onClick={() => point("feed", { method: "bottle", amountMl: Number(bottleMl) })}>
            {t("sheets.save")}
          </button>
        </div>
      </Sheet>

      <Sheet open={sheet === "diaper"} onClose={() => setSheet(null)} title={t("actions.diaper")}>
        <div className="grid grid-cols-3 gap-2">
          {(["wet", "dirty", "both"] as const).map((kind) => (
            <button key={kind} className="rounded-xl bg-zinc-800 py-4 font-medium active:bg-zinc-700"
              onClick={() => point("diaper", { kind })}>
              {t(`diaper.${kind}`)}
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={sheet === "medicine"} onClose={() => setSheet(null)} title={t("actions.medicine")}>
        <div className="space-y-3">
          <input value={medName} onChange={(e) => setMedName(e.target.value)}
            placeholder={t("sheets.medName")} className={input} />
          <input value={medDose} onChange={(e) => setMedDose(e.target.value)}
            placeholder={t("sheets.medDose")} className={input} />
          <button className={primary} disabled={!medName.trim()}
            onClick={() => point("medicine", { name: medName.trim(), ...(medDose.trim() ? { dose: medDose.trim() } : {}) })}>
            {t("sheets.save")}
          </button>
        </div>
      </Sheet>

      <Sheet open={sheet === "solids"} onClose={() => setSheet(null)} title={t("actions.solids")}>
        <div className="space-y-3">
          <input value={food} onChange={(e) => setFood(e.target.value)}
            placeholder={t("sheets.food")} className={input} />
          <button className={primary} disabled={!food.trim()}
            onClick={() => point("feed", { method: "solids", food: food.trim() })}>
            {t("sheets.save")}
          </button>
        </div>
      </Sheet>
    </>
  );
}
```

- [ ] **Step 5: Create `src/components/TimeSinceCards.tsx`**

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useNow } from "@/hooks/useNow";
import { formatDuration } from "@/lib/format";
import type { ApiEvent } from "@/lib/types";

function since(now: Date, iso: string): number {
  return (now.getTime() - new Date(iso).getTime()) / 60_000;
}

export default function TimeSinceCards({ events }: { events: ApiEvent[] }) {
  const t = useTranslations("timeSince");
  const now = useNow(30_000);

  const lastFeed = events.find((e) => e.type === "feed");
  const lastSleep = events.find((e) => e.type === "sleep" && e.endedAt !== null);
  const lastDiaper = events.find((e) => e.type === "diaper");

  const cards = [
    { label: t("lastFeed"), ref: lastFeed ? (lastFeed.endedAt ?? lastFeed.startedAt) : null },
    { label: t("lastSleep"), ref: lastSleep ? lastSleep.endedAt : null },
    { label: t("lastDiaper"), ref: lastDiaper ? lastDiaper.startedAt : null },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl bg-zinc-900 p-3 text-center">
          <div className="text-xs text-zinc-500">{c.label}</div>
          <div className="mt-1 text-sm font-semibold">
            {c.ref ? t("ago", { duration: formatDuration(since(now, c.ref)) }) : t("never")}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Replace `src/app/page.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import RunningTimers from "@/components/RunningTimers";
import ActionGrid from "@/components/ActionGrid";
import TimeSinceCards from "@/components/TimeSinceCards";
import EventItem from "@/components/EventItem";
import { useRecentEvents } from "@/hooks/useEvents";
import { useBaby } from "@/hooks/useBaby";

export default function HomePage() {
  const t = useTranslations();
  const summaryT = useTranslations("summary");
  const locale = useLocale();
  const { data: baby, isLoading: babyLoading } = useBaby();
  const { data } = useRecentEvents();

  const events = data?.events ?? [];
  const running = data?.running ?? [];
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const today = events.filter((e) => new Date(e.startedAt) >= todayStart);

  if (!babyLoading && baby === null) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-5xl">👶</div>
        <h1 className="text-xl font-bold">{t("onboarding.title")}</h1>
        <p className="text-zinc-400">{t("onboarding.text")}</p>
        <Link href="/settings" className="rounded-xl bg-sky-600 px-6 py-3 font-semibold">
          {t("onboarding.cta")}
        </Link>
      </main>
    );
  }

  return (
    <main className="space-y-4 p-4 pb-28">
      <RunningTimers running={running} />
      <ActionGrid />
      <TimeSinceCards events={events} />
      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">{t("timeline.today")}</h2>
        {today.length === 0 ? (
          <p className="text-sm text-zinc-600">{t("timeline.empty")}</p>
        ) : (
          <div className="space-y-1.5">
            {today.map((e) => (
              <EventItem key={e.id} event={e} locale={locale} summaryT={summaryT}
                runningLabel={summaryT("running")} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 7: Verify in browser**

```bash
npm run dev &
sleep 5
# seed a baby through the API:
curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"secret":"bonjour-bebe"}' -c /tmp/bm-cookies.txt
curl -s -X POST http://localhost:3000/api/baby -b /tmp/bm-cookies.txt -H 'Content-Type: application/json' -d '{"name":"Léo","birthDate":"2026-06-01"}'
```

In the browser (localhost:3000, after login): tap "Sein G" → running timer appears counting up; tap "Sein D" → red toast "minuteur déjà en cours"; Stop → timer moves into today's timeline with duration; Couche → sheet with Pipi/Caca/Les deux → tap one → appears in timeline; Biberon → 90 ml → saved; "Dernier repas / Dernière couche" cards populate. Stop server, kill %1.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: home screen with cross-device timers, quick actions, time-since cards"
```

---

### Task 11: Edit sheet + History screen

**Files:**
- Create: `src/components/EditEventSheet.tsx`, `src/app/history/page.tsx`
- Modify: `src/app/page.tsx` (wire edit sheet into today timeline)

**Interfaces:**
- Consumes: `useUpdateEvent`, `useDeleteEvent`, `Sheet`, `EventItem`, `toLocalInput/fromLocalInput`.
- Produces: `EditEventSheet({ event, onClose })` — renders nothing when `event` is null.

- [ ] **Step 1: Create `src/components/EditEventSheet.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Sheet from "@/components/Sheet";
import { useDeleteEvent, useUpdateEvent } from "@/hooks/useEvents";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import type { ApiEvent, Caregiver } from "@/lib/types";

export default function EditEventSheet({
  event, onClose,
}: { event: ApiEvent | null; onClose: () => void }) {
  const t = useTranslations("edit");
  const tc = useTranslations("caregiver");
  const td = useTranslations("diaper");
  const update = useUpdateEvent();
  const del = useDeleteEvent();

  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [caregiver, setCaregiver] = useState<Caregiver>("maman");
  const [details, setDetails] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!event) return;
    setStart(toLocalInput(new Date(event.startedAt)));
    setEnd(event.endedAt ? toLocalInput(new Date(event.endedAt)) : "");
    setNote(event.note ?? "");
    setCaregiver(event.caregiver);
    setDetails(event.details);
  }, [event]);

  if (!event) return null;

  const input = "w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 outline-none focus:border-sky-500";
  const label = "mb-1 block text-xs text-zinc-500";

  function save() {
    if (!event) return;
    update.mutate({
      id: event.id,
      startedAt: fromLocalInput(start).toISOString(),
      endedAt: end ? fromLocalInput(end).toISOString() : null,
      details,
      note: note.trim() ? note.trim() : null,
      caregiver,
    });
    onClose();
  }

  function remove() {
    if (!event) return;
    if (window.confirm(t("confirmDelete"))) {
      del.mutate(event.id);
      onClose();
    }
  }

  const setDet = (key: string, value: unknown) =>
    setDetails((d) => ({ ...d, [key]: value }));

  return (
    <Sheet open onClose={onClose} title={t("title")}>
      <div className="space-y-3">
        <div>
          <label className={label}>{t("start")}</label>
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={input} />
        </div>
        <div>
          <label className={label}>{t("end")}</label>
          <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className={input} />
          {!end && <p className="mt-1 text-xs text-sky-400">{t("running")}</p>}
        </div>

        {event.type === "feed" && details.method === "bottle" && (
          <input type="number" inputMode="numeric" value={String(details.amountMl ?? "")}
            onChange={(e) => setDet("amountMl", Number(e.target.value) || undefined)}
            className={input} />
        )}
        {event.type === "feed" && details.method === "breast" && (
          <div className="grid grid-cols-2 gap-2">
            {(["left", "right"] as const).map((s) => (
              <button key={s} onClick={() => setDet("side", s)}
                className={`rounded-xl py-2.5 ${details.side === s ? "bg-sky-600" : "bg-zinc-800"}`}>
                {s === "left" ? "G" : "D"}
              </button>
            ))}
          </div>
        )}
        {event.type === "diaper" && (
          <div className="grid grid-cols-3 gap-2">
            {(["wet", "dirty", "both"] as const).map((k) => (
              <button key={k} onClick={() => setDet("kind", k)}
                className={`rounded-xl py-2.5 text-sm ${details.kind === k ? "bg-sky-600" : "bg-zinc-800"}`}>
                {td(k)}
              </button>
            ))}
          </div>
        )}
        {event.type === "pump" && (
          <div className="grid grid-cols-2 gap-2">
            <input type="number" inputMode="numeric" placeholder="G ml" value={String(details.leftMl ?? "")}
              onChange={(e) => setDet("leftMl", Number(e.target.value) || undefined)} className={input} />
            <input type="number" inputMode="numeric" placeholder="D ml" value={String(details.rightMl ?? "")}
              onChange={(e) => setDet("rightMl", Number(e.target.value) || undefined)} className={input} />
          </div>
        )}
        {event.type === "medicine" && (
          <input value={String(details.name ?? "")} onChange={(e) => setDet("name", e.target.value)} className={input} />
        )}

        <div>
          <label className={label}>{t("note")}</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={input} />
        </div>
        <div>
          <label className={label}>{t("caregiver")}</label>
          <div className="grid grid-cols-2 gap-2">
            {(["maman", "papa"] as const).map((c) => (
              <button key={c} onClick={() => setCaregiver(c)}
                className={`rounded-xl py-2.5 ${caregiver === c ? "bg-sky-600" : "bg-zinc-800"}`}>
                {tc(c)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={remove} className="flex-1 rounded-xl bg-red-900/60 py-3 font-semibold text-red-200">
            {t("delete")}
          </button>
          <button onClick={save} className="flex-[2] rounded-xl bg-sky-600 py-3 font-semibold">
            {t("save")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
```

- [ ] **Step 2: Create `src/app/history/page.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import EventItem from "@/components/EventItem";
import EditEventSheet from "@/components/EditEventSheet";
import { api } from "@/lib/api-client";
import type { ApiEvent, EventType } from "@/lib/types";

const PAGE = 100;
const TYPES: (EventType | null)[] = [null, "feed", "sleep", "diaper", "pump", "medicine"];
const chipLabels: Record<string, string> = {
  feed: "🍼", sleep: "😴", diaper: "🧷", pump: "🥛", medicine: "💊",
};

export default function HistoryPage() {
  const t = useTranslations();
  const summaryT = useTranslations("summary");
  const locale = useLocale();
  const [filter, setFilter] = useState<EventType | null>(null);
  const [editing, setEditing] = useState<ApiEvent | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["events", "history", filter],
    queryFn: ({ pageParam }) =>
      api.get<{ events: ApiEvent[] }>(
        `/api/events?limit=${PAGE}${filter ? `&type=${filter}` : ""}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`,
      ),
    initialPageParam: "",
    getNextPageParam: (last) =>
      last.events.length === PAGE ? last.events[last.events.length - 1].startedAt : undefined,
  });

  const events = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p.events),
    [query.data],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, ApiEvent[]>();
    for (const e of events) {
      const day = new Date(e.startedAt).toLocaleDateString(
        locale === "fr" ? "fr-FR" : "en-GB",
        { weekday: "long", day: "numeric", month: "long" },
      );
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(e);
    }
    return [...map.entries()];
  }, [events, locale]);

  return (
    <main className="space-y-4 p-4 pb-28">
      <h1 className="text-xl font-bold">{t("history.title")}</h1>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {TYPES.map((type) => (
          <button
            key={type ?? "all"}
            onClick={() => setFilter(type)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm ${filter === type ? "bg-sky-600" : "bg-zinc-900"}`}
          >
            {type ? chipLabels[type] : t("history.all")}
          </button>
        ))}
      </div>

      {events.length === 0 && !query.isLoading && (
        <p className="text-sm text-zinc-600">{t("history.empty")}</p>
      )}

      {byDay.map(([day, dayEvents]) => (
        <section key={day}>
          <h2 className="mb-2 text-sm font-semibold capitalize text-zinc-400">{day}</h2>
          <div className="space-y-1.5">
            {dayEvents.map((e) => (
              <EventItem key={e.id} event={e} locale={locale} summaryT={summaryT}
                runningLabel={summaryT("running")} onClick={() => setEditing(e)} />
            ))}
          </div>
        </section>
      ))}

      {query.hasNextPage && (
        <button onClick={() => query.fetchNextPage()}
          className="w-full rounded-xl bg-zinc-900 py-3 text-sm">
          {t("history.loadMore")}
        </button>
      )}

      <EditEventSheet event={editing} onClose={() => setEditing(null)} />
    </main>
  );
}
```

- [ ] **Step 3: Wire edit sheet into Home** — in `src/app/page.tsx`:

Add imports and state:

```tsx
import { useState } from "react";
import EditEventSheet from "@/components/EditEventSheet";
import type { ApiEvent } from "@/lib/types";
```

Inside the component: `const [editing, setEditing] = useState<ApiEvent | null>(null);`
On each timeline `EventItem`, add `onClick={() => setEditing(e)}`.
Before `</main>`: `<EditEventSheet event={editing} onClose={() => setEditing(null)} />`.

- [ ] **Step 4: Verify in browser** — dev server: History shows day-grouped entries; filter chips work; tapping an entry opens the edit sheet; changing the end time updates the duration; delete asks for confirmation and removes the entry; on Home, tapping a timeline entry also opens editing. `npm run test` still passes.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: history screen with filters and event edit/delete sheet"
```

---

### Task 12: Stats screen (charts + growth + measurement form)

**Files:**
- Create: `src/components/BarChart.tsx`, `src/components/LineChart.tsx`, `src/app/stats/page.tsx`

**Interfaces:**
- Consumes: `useStats`, `useMeasurements`, `useCreateMeasurement`.
- Produces: `BarChart({ data: { label: string; value: number }[], color? })`, `LineChart({ points: { label: string; value: number }[] })`.

- [ ] **Step 1: Create `src/components/BarChart.tsx`**

```tsx
"use client";

export default function BarChart({
  data, color = "bg-sky-500",
}: { data: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex h-36 items-end gap-1.5">
      {data.map((d, i) => (
        <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
          <span className="text-[10px] tabular-nums text-zinc-400">
            {d.value > 0 ? Math.round(d.value * 10) / 10 : ""}
          </span>
          <div className={`w-full rounded-t ${color}`}
            style={{ height: `${(d.value / max) * 75}%`, minHeight: d.value > 0 ? 2 : 0 }} />
          <span className="text-[10px] text-zinc-500">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/LineChart.tsx`**

```tsx
"use client";

export default function LineChart({
  points,
}: { points: { label: string; value: number }[] }) {
  if (points.length < 2) return null;
  const W = 320, H = 140, PAD = 24;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (points.length - 1);
  const y = (v: number) => H - PAD - ((v - min) * (H - 2 * PAD)) / span;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <path d={path} fill="none" stroke="#38bdf8" strokeWidth="2" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r="3" fill="#38bdf8" />
          <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="#71717a">{p.label}</text>
        </g>
      ))}
      <text x={PAD - 4} y={y(max) + 3} textAnchor="end" fontSize="9" fill="#71717a">{max}</text>
      <text x={PAD - 4} y={y(min) + 3} textAnchor="end" fontSize="9" fill="#71717a">{min}</text>
    </svg>
  );
}
```

- [ ] **Step 3: Create `src/app/stats/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import BarChart from "@/components/BarChart";
import LineChart from "@/components/LineChart";
import { useStats } from "@/hooks/useStats";
import { useCreateMeasurement, useMeasurements } from "@/hooks/useMeasurements";

export default function StatsPage() {
  const t = useTranslations("stats");
  const locale = useLocale();
  const { data: days } = useStats(7);
  const { data: measurements } = useMeasurements();
  const createMeasurement = useCreateMeasurement();

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [head, setHead] = useState("");

  const dayLabel = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { weekday: "narrow" });

  const chart = (fn: (d: NonNullable<typeof days>[number]) => number) =>
    (days ?? []).map((d) => ({ label: dayLabel(d.date), value: fn(d) }));

  const weightPoints = (measurements ?? [])
    .filter((m) => m.weightG != null)
    .map((m) => ({ label: m.measuredAt.slice(5), value: Math.round((m.weightG! / 1000) * 100) / 100 }));
  const heightPoints = (measurements ?? [])
    .filter((m) => m.heightMm != null)
    .map((m) => ({ label: m.measuredAt.slice(5), value: Math.round(m.heightMm! / 10) }));

  function saveMeasurement() {
    const body: Record<string, unknown> = { measuredAt: date };
    if (Number(weight)) body.weightG = Math.round(Number(weight) * 1000);
    if (Number(height)) body.heightMm = Math.round(Number(height) * 10);
    if (Number(head)) body.headCircMm = Math.round(Number(head) * 10);
    createMeasurement.mutate(body);
    setWeight(""); setHeight(""); setHead("");
  }

  const input = "w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 outline-none focus:border-sky-500";
  const section = "rounded-2xl bg-zinc-900/60 p-4";

  return (
    <main className="space-y-4 p-4 pb-28">
      <h1 className="text-xl font-bold">{t("title")}</h1>

      <section className={section}>
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">{t("sleepPerDay")}</h2>
        <BarChart data={chart((d) => Math.round((d.sleepMinutes / 60) * 10) / 10)} color="bg-indigo-500" />
      </section>
      <section className={section}>
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">{t("feedsPerDay")}</h2>
        <BarChart data={chart((d) => d.feedCount)} />
      </section>
      <section className={section}>
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">{t("bottleMlPerDay")}</h2>
        <BarChart data={chart((d) => d.bottleMl)} color="bg-teal-500" />
      </section>
      <section className={section}>
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">{t("diapersPerDay")}</h2>
        <BarChart data={chart((d) => d.diaperWet + d.diaperDirty + d.diaperBoth)} color="bg-amber-500" />
      </section>
      <section className={section}>
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">{t("pumpMlPerDay")}</h2>
        <BarChart data={chart((d) => d.pumpMl)} color="bg-pink-500" />
      </section>

      <section className={section}>
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">{t("growth")}</h2>
        {weightPoints.length >= 2 ? (
          <>
            <p className="text-xs text-zinc-500">{t("weight")}</p>
            <LineChart points={weightPoints} />
          </>
        ) : (
          <p className="text-sm text-zinc-600">{t("needTwoPoints")}</p>
        )}
        {heightPoints.length >= 2 && (
          <>
            <p className="mt-2 text-xs text-zinc-500">{t("height")}</p>
            <LineChart points={heightPoints} />
          </>
        )}
      </section>

      <section className={section}>
        <h2 className="mb-3 text-sm font-semibold text-zinc-400">{t("addMeasurement")}</h2>
        <div className="space-y-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
          <input type="number" inputMode="decimal" step="0.01" placeholder={t("weightKg")}
            value={weight} onChange={(e) => setWeight(e.target.value)} className={input} />
          <input type="number" inputMode="decimal" step="0.1" placeholder={t("heightCm")}
            value={height} onChange={(e) => setHeight(e.target.value)} className={input} />
          <input type="number" inputMode="decimal" step="0.1" placeholder={t("headCm")}
            value={head} onChange={(e) => setHead(e.target.value)} className={input} />
          <button onClick={saveMeasurement}
            disabled={!Number(weight) && !Number(height) && !Number(head)}
            className="w-full rounded-xl bg-sky-600 py-3 font-semibold disabled:opacity-50">
            {t("save")}
          </button>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Verify in browser** — Stats tab shows 7-day bars matching logged events; adding two measurements (different dates) draws the weight curve. `npm run test` passes.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: stats screen with 7-day charts and growth curves"
```

---

### Task 13: Settings screen

**Files:**
- Create: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `useBaby`, `useSaveBaby`, `useCaregiver`, `toast`.

- [ ] **Step 1: Create `src/app/settings/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "@/components/Toast";
import { useBaby, useSaveBaby } from "@/hooks/useBaby";
import { useCaregiver } from "@/hooks/useCaregiver";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("caregiver");
  const locale = useLocale();
  const { data: baby } = useBaby();
  const saveBaby = useSaveBaby();
  const [caregiver, setCaregiver] = useCaregiver();

  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");

  useEffect(() => {
    if (baby) { setName(baby.name); setBirthDate(baby.birthDate); }
  }, [baby]);

  function setLocale(next: "fr" | "en") {
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000`;
    window.location.reload();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const input = "w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 outline-none focus:border-sky-500";
  const section = "rounded-2xl bg-zinc-900/60 p-4";
  const segBtn = (active: boolean) =>
    `flex-1 rounded-xl py-2.5 font-medium ${active ? "bg-sky-600" : "bg-zinc-800"}`;

  return (
    <main className="space-y-4 p-4 pb-28">
      <h1 className="text-xl font-bold">{t("title")}</h1>

      <section className={section}>
        <h2 className="mb-3 text-sm font-semibold text-zinc-400">{t("babySection")}</h2>
        <div className="space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder={t("name")} className={input} />
          <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)}
            className={input} />
          <button
            disabled={!name.trim() || !birthDate || saveBaby.isPending}
            onClick={() =>
              saveBaby.mutate(
                { name: name.trim(), birthDate, exists: !!baby },
                { onSuccess: () => toast(t("saved")) },
              )}
            className="w-full rounded-xl bg-sky-600 py-3 font-semibold disabled:opacity-50">
            {t("save")}
          </button>
        </div>
      </section>

      <section className={section}>
        <h2 className="mb-3 text-sm font-semibold text-zinc-400">{t("caregiverSection")}</h2>
        <div className="flex gap-2">
          <button className={segBtn(caregiver === "maman")} onClick={() => setCaregiver("maman")}>{tc("maman")}</button>
          <button className={segBtn(caregiver === "papa")} onClick={() => setCaregiver("papa")}>{tc("papa")}</button>
        </div>
      </section>

      <section className={section}>
        <h2 className="mb-3 text-sm font-semibold text-zinc-400">{t("languageSection")}</h2>
        <div className="flex gap-2">
          <button className={segBtn(locale === "fr")} onClick={() => setLocale("fr")}>Français</button>
          <button className={segBtn(locale === "en")} onClick={() => setLocale("en")}>English</button>
        </div>
      </section>

      <button onClick={logout} className="w-full rounded-xl bg-zinc-900 py-3 font-semibold text-red-400">
        {t("logout")}
      </button>
    </main>
  );
}
```

Note: the toast component is red (error-styled); using it for "Saved!" is acceptable for v1 — or pass no toast and rely on the button state. Keep the toast call; restyle later if it bothers.

- [ ] **Step 2: Verify in browser** — edit baby name → Enregistrer → reload keeps it; caregiver toggle persists across reloads (localStorage); switching language to English re-renders all labels; logout redirects to `/login` and API calls 401. `npm run test` passes.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: settings screen (baby profile, caregiver, language, logout)"
```

---

### Task 14: PWA manifest, icon, README, final verification

**Files:**
- Create: `src/app/manifest.ts`, `public/icon.svg`, `.env.example`
- Modify: `README.md`

**Interfaces:** none new — final polish + verification gate.

- [ ] **Step 1: Create `src/app/manifest.ts`**

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Baby Marks",
    short_name: "Baby Marks",
    description: "Baby feeding & sleep tracker",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
```

- [ ] **Step 2: Create `public/icon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#0c4a6e"/>
  <text x="50" y="66" font-size="52" text-anchor="middle">🍼</text>
</svg>
```

- [ ] **Step 3: Create `.env.example`**

```
# Postgres connection string.
# Local dev without Postgres: DATABASE_URL=pglite://.pglite/dev
# Production (Vercel): use the Neon/Vercel Postgres pooled connection string.
DATABASE_URL=pglite://.pglite/dev

# Shared secret both parents type once per device.
APP_SECRET_PHRASE=change-me
```

- [ ] **Step 4: Replace `README.md`**

```markdown
# Baby Marks 🍼

Mobile-first tracker for a baby's feedings, sleep, diapers, pumping, medicine and growth.
Built for two parents sharing one database — timers sync between phones.

## Local dev

```bash
cp .env.example .env.local   # defaults to a local PGlite database, no Postgres needed
npm install
npm run dev                  # http://localhost:3000 — log in with APP_SECRET_PHRASE
```

Tests: `npm run test`

## Deploy (Vercel + Neon)

1. Push this repo to GitHub and import it in Vercel.
2. In Vercel: Storage → create a Postgres (Neon) database, or set `DATABASE_URL` manually.
3. Set env vars in Vercel: `DATABASE_URL` (pooled connection string) and `APP_SECRET_PHRASE`.
4. Apply the schema once from your machine:
   `DATABASE_URL="<neon-url>" npm run db:migrate`
5. Deploy. Open the URL on both phones, log in with the secret phrase, and
   "Add to Home Screen" to install it like an app.

## Stack

Next.js (App Router) · TanStack Query · Drizzle ORM · Postgres (PGlite in dev) · next-intl (fr/en) · Tailwind
```

- [ ] **Step 5: Final verification gate (all must pass)**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks"
npm run test          # all suites pass
npx tsc --noEmit      # no type errors
npm run build         # production build succeeds
```

Then a last manual smoke test with `npm run dev`: login → create baby (if fresh) → start/stop nursing timer → diaper → check History, Stats, Settings, language switch.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: PWA manifest, icon, README and env example"
```
