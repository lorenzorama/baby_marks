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
