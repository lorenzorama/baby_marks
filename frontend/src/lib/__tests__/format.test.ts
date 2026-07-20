import { describe, it, expect } from "vitest";
import { formatDuration, formatClock, toLocalInput, fromLocalInput, formatTime } from "@/lib/format";

describe("format", () => {
  it("formatDuration", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1h00");
    expect(formatDuration(125)).toBe("2h05");
  });

  it("formatClock", () => {
    expect(formatClock(59)).toBe("0:00:59");
    expect(formatClock(83)).toBe("0:01:23");
    expect(formatClock(3665)).toBe("1:01:05");
  });

  it("local input round-trip", () => {
    const d = new Date(2026, 6, 15, 14, 5); // local time
    expect(toLocalInput(d)).toBe("2026-07-15T14:05");
    expect(fromLocalInput("2026-07-15T14:05").getTime()).toBe(d.getTime());
  });

  it("formatTime", () => {
    const iso = new Date(2026, 6, 15, 14, 5).toISOString(); // local 14:05
    expect(formatTime(iso, "fr")).toBe("14:05");
    expect(formatTime(iso, "en")).toBe("14:05");
  });
});
