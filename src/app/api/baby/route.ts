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
