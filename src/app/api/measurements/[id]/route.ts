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
