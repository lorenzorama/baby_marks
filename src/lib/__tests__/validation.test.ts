import { describe, it, expect } from "vitest";
import { createEventSchema, patchEventSchema, measurementSchema, babySchema } from "@/lib/validation";

const base = { caregiver: "maman", startedAt: "2026-07-15T10:00:00Z" };

describe("createEventSchema", () => {
  it("accepts a running breast feed", () => {
    const r = createEventSchema.safeParse({
      ...base, type: "feed", endedAt: null,
      details: { method: "breast", side: "left" },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.startedAt).toBeInstanceOf(Date);
      expect(r.data.endedAt).toBeNull();
    }
  });

  it("accepts a completed bottle with ml", () => {
    const r = createEventSchema.safeParse({
      ...base, type: "feed", endedAt: "2026-07-15T10:10:00Z",
      details: { method: "bottle", amountMl: 90 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects bottle with negative ml", () => {
    const r = createEventSchema.safeParse({
      ...base, type: "feed", endedAt: null,
      details: { method: "bottle", amountMl: -5 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects diaper without kind", () => {
    const r = createEventSchema.safeParse({
      ...base, type: "diaper", endedAt: base.startedAt, details: {},
    });
    expect(r.success).toBe(false);
  });

  it("rejects diaper without endedAt (point events need an end)", () => {
    const r = createEventSchema.safeParse({
      ...base, type: "diaper", endedAt: null, details: { kind: "wet" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects endedAt before startedAt", () => {
    const r = createEventSchema.safeParse({
      ...base, type: "sleep", endedAt: "2026-07-15T09:00:00Z", details: {},
    });
    expect(r.success).toBe(false);
  });

  it("rejects medicine without name", () => {
    const r = createEventSchema.safeParse({
      ...base, type: "medicine", endedAt: base.startedAt, details: {},
    });
    expect(r.success).toBe(false);
  });
});

describe("patchEventSchema", () => {
  it("accepts a partial patch (stop timer)", () => {
    const r = patchEventSchema.safeParse({ endedAt: "2026-07-15T11:00:00Z" });
    expect(r.success).toBe(true);
  });
  it("accepts explicit null endedAt (restart timer)", () => {
    const r = patchEventSchema.safeParse({ endedAt: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.endedAt).toBeNull();
  });
});

describe("measurementSchema", () => {
  it("accepts weight-only measurement", () => {
    const r = measurementSchema.safeParse({ measuredAt: "2026-07-15", weightG: 4200 });
    expect(r.success).toBe(true);
  });
  it("rejects measurement with no values", () => {
    const r = measurementSchema.safeParse({ measuredAt: "2026-07-15" });
    expect(r.success).toBe(false);
  });
});

describe("babySchema", () => {
  it("accepts name + birthDate", () => {
    expect(babySchema.safeParse({ name: "Léo", birthDate: "2026-06-01" }).success).toBe(true);
  });
  it("rejects bad date", () => {
    expect(babySchema.safeParse({ name: "Léo", birthDate: "01/06/2026" }).success).toBe(false);
  });
});
