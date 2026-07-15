import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, computeAuthToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const secret = process.env.APP_SECRET_PHRASE;
  if (!secret) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
  const body = await req.json().catch(() => null);
  // Compare HMAC-SHA256 digests of the submitted and configured secrets rather than the raw
  // strings: computeAuthToken always yields fixed-length hex digests, so a plain !== here can't
  // leak the secret's length or short-circuit character-by-character the way comparing the raw
  // secrets would, without needing a separate timingSafeEqual helper.
  if (
    !body ||
    typeof body.secret !== "string" ||
    (await computeAuthToken(body.secret)) !== (await computeAuthToken(secret))
  ) {
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
