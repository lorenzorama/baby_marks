import { describe, it, expect } from "vitest";
import { aggregateDaily, StatEvent } from "@/lib/stats";

const now = new Date("2026-07-15T12:00:00Z");
const ev = (partial: Partial<StatEvent> & Pick<StatEvent, "type" | "startedAt">): StatEvent => ({
  endedAt: null, details: {}, ...partial,
});

describe("aggregateDaily", () => {
  it("returns `days` entries, oldest first, ending today", () => {
    const out = aggregateDaily([], 7, 0, now);
    expect(out).toHaveLength(7);
    expect(out[0].date).toBe("2026-07-09");
    expect(out[6].date).toBe("2026-07-15");
  });

  it("splits a sleep spanning midnight across both days (tz=0)", () => {
    const out = aggregateDaily([ev({
      type: "sleep",
      startedAt: new Date("2026-07-14T23:00:00Z"),
      endedAt: new Date("2026-07-15T01:30:00Z"),
    })], 7, 0, now);
    expect(out.find((d) => d.date === "2026-07-14")!.sleepMinutes).toBe(60);
    expect(out.find((d) => d.date === "2026-07-15")!.sleepMinutes).toBe(90);
  });

  it("buckets by local day using tzOffset (Paris summer, -120)", () => {
    // 23:30 Paris on Jul 14 = 21:30Z Jul 14 — must land on Jul 14, not Jul 15
    const out = aggregateDaily([ev({
      type: "diaper",
      startedAt: new Date("2026-07-14T21:30:00Z"),
      endedAt: new Date("2026-07-14T21:30:00Z"),
      details: { kind: "wet" },
    })], 7, -120, now);
    expect(out.find((d) => d.date === "2026-07-14")!.diaperWet).toBe(1);
  });

  it("counts a running sleep up to now", () => {
    const out = aggregateDaily([ev({
      type: "sleep", startedAt: new Date("2026-07-15T11:00:00Z"),
    })], 7, 0, now);
    expect(out.find((d) => d.date === "2026-07-15")!.sleepMinutes).toBe(60);
  });

  it("sums feeds, bottles, breast minutes, pump ml, diapers, medicine", () => {
    const out = aggregateDaily([
      ev({ type: "feed", startedAt: new Date("2026-07-15T08:00:00Z"), endedAt: new Date("2026-07-15T08:20:00Z"), details: { method: "breast", side: "left" } }),
      ev({ type: "feed", startedAt: new Date("2026-07-15T10:00:00Z"), endedAt: new Date("2026-07-15T10:05:00Z"), details: { method: "bottle", amountMl: 90 } }),
      ev({ type: "pump", startedAt: new Date("2026-07-15T09:00:00Z"), endedAt: new Date("2026-07-15T09:15:00Z"), details: { leftMl: 60, rightMl: 40 } }),
      ev({ type: "diaper", startedAt: new Date("2026-07-15T07:00:00Z"), endedAt: new Date("2026-07-15T07:00:00Z"), details: { kind: "dirty" } }),
      ev({ type: "medicine", startedAt: new Date("2026-07-15T07:30:00Z"), endedAt: new Date("2026-07-15T07:30:00Z"), details: { name: "Vit D" } }),
    ], 1, 0, now);
    const d = out[0];
    expect(d.feedCount).toBe(2);
    expect(d.breastMinutes).toBe(20);
    expect(d.bottleMl).toBe(90);
    expect(d.pumpMl).toBe(100);
    expect(d.diaperDirty).toBe(1);
    expect(d.medicineCount).toBe(1);
  });

  it("ignores events outside the window", () => {
    const out = aggregateDaily([ev({
      type: "diaper", startedAt: new Date("2026-07-01T10:00:00Z"),
      endedAt: new Date("2026-07-01T10:00:00Z"), details: { kind: "wet" },
    })], 7, 0, now);
    expect(out.every((d) => d.diaperWet === 0)).toBe(true);
  });
});
