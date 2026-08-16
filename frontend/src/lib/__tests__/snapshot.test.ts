import { describe, expect, it } from "vitest";
import { fitWithin, MAX_SNAPSHOT_PX } from "@/lib/snapshot";

describe("fitWithin", () => {
  it("leaves small images untouched", () => {
    expect(fitWithin(640, 480, 1280)).toEqual({ width: 640, height: 480 });
  });

  it("scales a landscape image down to the cap on its long side", () => {
    expect(fitWithin(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 });
  });

  it("scales a portrait image down to the cap on its long side", () => {
    expect(fitWithin(1080, 1920, 1280)).toEqual({ width: 720, height: 1280 });
  });

  it("never returns a zero dimension", () => {
    expect(fitWithin(4000, 3, 1280)).toEqual({ width: 1280, height: 1 });
  });

  it("exposes a sane default cap", () => {
    expect(MAX_SNAPSHOT_PX).toBe(1280);
  });
});
