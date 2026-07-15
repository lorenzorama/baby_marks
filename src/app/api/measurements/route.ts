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
