import { NextRequest } from "next/server";
import { COOKIE_NAME, computeAuthToken } from "@/lib/auth";
import { getDb } from "@/db";
import { babies, events, measurements } from "@/db/schema";

export async function resetDb() {
  const db = await getDb();
  await db.delete(events);
  await db.delete(measurements);
  await db.delete(babies);
}

export async function seedBaby(name = "Test") {
  const db = await getDb();
  const [baby] = await db.insert(babies).values({ name, birthDate: "2026-06-01" }).returning();
  return baby;
}

function buildRequest(url: string, init: RequestInit | undefined, cookie?: string) {
  const headers = new Headers(init?.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init?.body) headers.set("content-type", "application/json");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(new URL(url, "http://localhost:3000"), { ...init, headers } as any);
}

export async function authedRequest(url: string, init?: RequestInit) {
  const token = await computeAuthToken(process.env.APP_SECRET_PHRASE!);
  return buildRequest(url, init, `${COOKIE_NAME}=${token}`);
}

export function unauthedRequest(url: string, init?: RequestInit) {
  return buildRequest(url, init);
}
