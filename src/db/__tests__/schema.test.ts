import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "@/db";
import { babies, events } from "@/db/schema";

describe("db schema", () => {
  beforeAll(async () => { await getDb(); });

  it("round-trips a baby and an event", async () => {
    const db = await getDb();
    const [baby] = await db.insert(babies)
      .values({ name: "Test", birthDate: "2026-06-01" }).returning();
    expect(baby.id).toBeGreaterThan(0);

    const started = new Date("2026-07-15T10:00:00Z");
    const [ev] = await db.insert(events).values({
      babyId: baby.id, type: "sleep", startedAt: started, endedAt: null,
      details: {}, caregiver: "maman",
    }).returning();
    expect(ev.endedAt).toBeNull();
    expect(ev.startedAt.toISOString()).toBe(started.toISOString());
    expect(ev.details).toEqual({});
  });
});
