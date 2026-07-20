import { describe, it, expect } from "vitest";
import { computeAuthToken, isAuthed } from "@/lib/auth";

function fakeReq(cookie?: string) {
  return { cookies: { get: (_: string) => (cookie ? { value: cookie } : undefined) } };
}

describe("auth", () => {
  it("token is deterministic 64-char hex", async () => {
    const a = await computeAuthToken("s1");
    const b = await computeAuthToken("s1");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different secrets give different tokens", async () => {
    expect(await computeAuthToken("s1")).not.toBe(await computeAuthToken("s2"));
  });

  it("isAuthed true with valid cookie, false otherwise", async () => {
    const token = await computeAuthToken(process.env.APP_SECRET_PHRASE!);
    expect(await isAuthed(fakeReq(token))).toBe(true);
    expect(await isAuthed(fakeReq("wrong"))).toBe(false);
    expect(await isAuthed(fakeReq())).toBe(false);
  });

  it("isAuthed false for cookie with different length", async () => {
    const token = await computeAuthToken(process.env.APP_SECRET_PHRASE!);
    expect(await isAuthed(fakeReq(token.slice(0, -1)))).toBe(false);
    expect(await isAuthed(fakeReq(token + "a"))).toBe(false);
  });

  it("isAuthed false for same-length wrong cookie", async () => {
    const token = await computeAuthToken(process.env.APP_SECRET_PHRASE!);
    const wrongToken = token.slice(0, -1) + (token[token.length - 1] === "a" ? "b" : "a");
    expect(wrongToken).toHaveLength(token.length);
    expect(wrongToken).not.toBe(token);
    expect(await isAuthed(fakeReq(wrongToken))).toBe(false);
  });
});
