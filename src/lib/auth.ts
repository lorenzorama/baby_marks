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
