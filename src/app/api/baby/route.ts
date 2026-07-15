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

  try {
    const [baby] = await db.insert(babies).values(parsed.data).returning();
    return NextResponse.json({ baby }, { status: 201 });
  } catch (err) {
    // drizzle-orm's pg-core session wraps driver errors in a DrizzleQueryError whose own
    // `.code` is undefined; the driver's original error (with `.code === "23505"` for a
    // Postgres/PGlite unique violation) lives on `.cause`. Check both shapes so this works
    // whether the raw driver error or the drizzle wrapper is what's caught.
    const cause = (err as { cause?: unknown })?.cause;
    const code = (err as { code?: string })?.code ?? (cause as { code?: string } | undefined)?.code;
    const message = err instanceof Error ? err.message : String(err);
    const causeMessage = cause instanceof Error ? cause.message : "";
    if (
      code === "23505" ||
      message.includes("babies_singleton") ||
      causeMessage.includes("babies_singleton")
    ) {
      return NextResponse.json({ error: "baby_exists" }, { status: 409 });
    }
    throw err;
  }
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
