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
