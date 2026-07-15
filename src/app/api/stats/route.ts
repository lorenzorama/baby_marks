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
