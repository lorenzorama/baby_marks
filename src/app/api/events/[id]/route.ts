import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { events } from "@/db/schema";
import { isAuthed } from "@/lib/auth";
import { detailsByType, patchEventSchema, TIMER_TYPES } from "@/lib/validation";

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

  if (merged.endedAt === null && TIMER_TYPES.includes(existing.type)) {
    const [running] = await db.select().from(events)
      .where(and(eq(events.type, existing.type), isNull(events.endedAt), ne(events.id, eventId)));
    if (running) {
      return NextResponse.json({ error: "timer_running", event: running }, { status: 409 });
    }
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
