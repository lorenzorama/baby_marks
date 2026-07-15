import { describe, it, expect, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/events/route";
import { PATCH, DELETE } from "@/app/api/events/[id]/route";
import { resetDb, seedBaby, authedRequest, unauthedRequest } from "@/test/helpers";

const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

function post(body: unknown, authed = true) {
  const init = { method: "POST", body: JSON.stringify(body) };
  return authed ? authedRequest("/api/events", init) : Promise.resolve(unauthedRequest("/api/events", init));
}

describe("events API", () => {
  beforeEach(async () => { await resetDb(); });

  it("rejects unauthenticated requests", async () => {
    const res = await GET(unauthedRequest("/api/events"));
    expect(res.status).toBe(401);
  });

  it("returns 400 no_baby when no baby exists", async () => {
    const res = await POST(await post({
      type: "sleep", startedAt: new Date().toISOString(), endedAt: null,
      details: {}, caregiver: "maman",
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("no_baby");
  });

  it("creates and lists a completed diaper event", async () => {
    await seedBaby();
    const now = new Date().toISOString();
    const created = await POST(await post({
      type: "diaper", startedAt: now, endedAt: now,
      details: { kind: "both" }, caregiver: "papa",
    }));
    expect(created.status).toBe(201);

    const listRes = await GET(await authedRequest("/api/events"));
    const list = await listRes.json();
    expect(list.events).toHaveLength(1);
    expect(list.events[0].details.kind).toBe("both");
    expect(list.running).toHaveLength(0);
  });

  it("409s when starting a second timer of the same type", async () => {
    await seedBaby();
    const body = {
      type: "sleep", startedAt: new Date().toISOString(), endedAt: null,
      details: {}, caregiver: "maman",
    };
    expect((await POST(await post(body))).status).toBe(201);
    const dup = await POST(await post(body));
    expect(dup.status).toBe(409);
    const json = await dup.json();
    expect(json.error).toBe("timer_running");
    expect(json.event.type).toBe("sleep");
  });

  it("stops a timer via PATCH and validates details on PATCH", async () => {
    await seedBaby();
    const created = await POST(await post({
      type: "feed", startedAt: "2026-07-15T02:00:00Z", endedAt: null,
      details: { method: "breast", side: "left" }, caregiver: "maman",
    }));
    const { event } = await created.json();

    const stopped = await PATCH(await authedRequest(`/api/events/${event.id}`, {
      method: "PATCH", body: JSON.stringify({ endedAt: "2026-07-15T02:25:00Z" }),
    }), ctx(event.id));
    expect(stopped.status).toBe(200);
    expect((await stopped.json()).event.endedAt).toBe("2026-07-15T02:25:00.000Z");

    const bad = await PATCH(await authedRequest(`/api/events/${event.id}`, {
      method: "PATCH", body: JSON.stringify({ details: { method: "nope" } }),
    }), ctx(event.id));
    expect(bad.status).toBe(400);
  });

  it("deletes an event, then 404s", async () => {
    await seedBaby();
    const created = await POST(await post({
      type: "medicine", startedAt: "2026-07-15T08:00:00Z", endedAt: "2026-07-15T08:00:00Z",
      details: { name: "Vitamine D" }, caregiver: "papa",
    }));
    const { event } = await created.json();

    const del = await DELETE(await authedRequest(`/api/events/${event.id}`, { method: "DELETE" }), ctx(event.id));
    expect(del.status).toBe(200);
    const again = await DELETE(await authedRequest(`/api/events/${event.id}`, { method: "DELETE" }), ctx(event.id));
    expect(again.status).toBe(404);
  });

  it("filters by type", async () => {
    await seedBaby();
    const now = new Date().toISOString();
    await POST(await post({ type: "diaper", startedAt: now, endedAt: now, details: { kind: "wet" }, caregiver: "maman" }));
    await POST(await post({ type: "sleep", startedAt: now, endedAt: now, details: {}, caregiver: "maman" }));
    const res = await GET(await authedRequest("/api/events?type=diaper"));
    const json = await res.json();
    expect(json.events).toHaveLength(1);
    expect(json.events[0].type).toBe("diaper");
  });
});
