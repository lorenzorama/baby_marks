import { describe, it, expect, beforeEach } from "vitest";
import { isNull, eq, and } from "drizzle-orm";
import { GET, POST } from "@/app/api/events/route";
import { PATCH, DELETE } from "@/app/api/events/[id]/route";
import { resetDb, seedBaby, authedRequest, unauthedRequest } from "@/test/helpers";
import { getDb } from "@/db";
import { events } from "@/db/schema";

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

  it("enforces one running timer per type at the DB level via a partial unique index", async () => {
    const baby = await seedBaby();
    const db = await getDb();
    const started = new Date("2026-07-15T03:00:00Z");

    await db.insert(events).values({
      babyId: baby.id, type: "sleep", startedAt: started, endedAt: null,
      details: {}, caregiver: "maman",
    });

    let caught: unknown;
    try {
      await db.insert(events).values({
        babyId: baby.id, type: "sleep", startedAt: started, endedAt: null,
        details: {}, caregiver: "papa",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    // drizzle-orm's pg-core session wraps the driver error in a DrizzleQueryError whose own
    // `.code` is undefined for both the `pg` driver and PGlite (both extend the same
    // pg-core session); the real Postgres/PGlite unique-violation code lives on `.cause.code`.
    const code = (caught as { code?: string } | undefined)?.code
      ?? ((caught as { cause?: { code?: string } } | undefined)?.cause)?.code;
    if (code !== undefined) {
      expect(code).toBe("23505");
    } else {
      const message = caught instanceof Error ? caught.message : String(caught);
      expect(message).toContain("events_one_running_per_type");
    }

    // The index is partial (WHERE ended_at IS NULL), so a completed event of the same type
    // still inserts fine even while a running one exists.
    const [completed] = await db.insert(events).values({
      babyId: baby.id, type: "sleep", startedAt: started, endedAt: new Date("2026-07-15T03:30:00Z"),
      details: {}, caregiver: "papa",
    }).returning();
    expect(completed.endedAt).not.toBeNull();

    const running = await db.select().from(events)
      .where(and(eq(events.type, "sleep"), isNull(events.endedAt)));
    expect(running).toHaveLength(1);
  });

  it("under a concurrent race, exactly one of two simultaneous POSTs for the same timer type succeeds", async () => {
    await seedBaby();
    const body = {
      type: "feed", startedAt: new Date().toISOString(), endedAt: null,
      details: { method: "breast", side: "left" }, caregiver: "maman",
    };
    const [resA, resB] = await Promise.all([
      POST(await post(body)),
      POST(await post(body)),
    ]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const conflict = resA.status === 409 ? resA : resB;
    const conflictJson = await conflict.json();
    expect(conflictJson.error).toBe("timer_running");
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

  it("409s when PATCH would restart a timer while another of the same type is running", async () => {
    await seedBaby();
    const completed = await POST(await post({
      type: "sleep", startedAt: "2026-07-15T01:00:00Z", endedAt: "2026-07-15T01:30:00Z",
      details: {}, caregiver: "maman",
    }));
    const { event: completedEvent } = await completed.json();

    await POST(await post({
      type: "sleep", startedAt: "2026-07-15T02:00:00Z", endedAt: null,
      details: {}, caregiver: "papa",
    }));

    const res = await PATCH(await authedRequest(`/api/events/${completedEvent.id}`, {
      method: "PATCH", body: JSON.stringify({ endedAt: null }),
    }), ctx(completedEvent.id));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("timer_running");
  });

  it("400s on GET with an invalid from date", async () => {
    await seedBaby();
    const res = await GET(await authedRequest("/api/events?from=garbage"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid");
  });

  it("400s on GET with an invalid type", async () => {
    await seedBaby();
    const res = await GET(await authedRequest("/api/events?type=bogus"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid");
  });
});
