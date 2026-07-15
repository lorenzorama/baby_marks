export type StatEvent = {
  type: string;
  startedAt: Date;
  endedAt: Date | null;
  details: Record<string, unknown>;
};

export type DayStats = {
  date: string;
  sleepMinutes: number;
  breastMinutes: number;
  feedCount: number;
  bottleMl: number;
  diaperWet: number;
  diaperDirty: number;
  diaperBoth: number;
  pumpMl: number;
  medicineCount: number;
};

const DAY_MS = 86_400_000;

function dayKey(d: Date, tzOffsetMinutes: number): string {
  return new Date(d.getTime() - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function emptyDay(date: string): DayStats {
  return {
    date, sleepMinutes: 0, breastMinutes: 0, feedCount: 0, bottleMl: 0,
    diaperWet: 0, diaperDirty: 0, diaperBoth: 0, pumpMl: 0, medicineCount: 0,
  };
}

/** End of the local day containing `d`, as a UTC instant. */
function nextLocalMidnight(d: Date, tzOffsetMinutes: number): Date {
  const local = new Date(d.getTime() - tzOffsetMinutes * 60_000);
  const midnightUtcOfNextLocalDay = Date.UTC(
    local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1,
  );
  return new Date(midnightUtcOfNextLocalDay + tzOffsetMinutes * 60_000);
}

export function aggregateDaily(
  eventsIn: StatEvent[], days: number, tzOffsetMinutes: number, now: Date,
): DayStats[] {
  const byDay = new Map<string, DayStats>();
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(new Date(now.getTime() - i * DAY_MS), tzOffsetMinutes);
    byDay.set(key, emptyDay(key));
  }

  for (const e of eventsIn) {
    // Durations (sleep + breast feeds) are spread across local days.
    const isBreast = e.type === "feed" && e.details?.method === "breast";
    if (e.type === "sleep" || isBreast) {
      const end = e.endedAt ?? now;
      let cursor = e.startedAt;
      while (cursor < end) {
        const boundary = nextLocalMidnight(cursor, tzOffsetMinutes);
        const sliceEnd = end < boundary ? end : boundary;
        const minutes = (sliceEnd.getTime() - cursor.getTime()) / 60_000;
        const day = byDay.get(dayKey(cursor, tzOffsetMinutes));
        if (day) {
          if (e.type === "sleep") day.sleepMinutes += minutes;
          else day.breastMinutes += minutes;
        }
        cursor = sliceEnd;
      }
    }

    // Counts/volumes attributed to the start day.
    const day = byDay.get(dayKey(e.startedAt, tzOffsetMinutes));
    if (!day) continue;
    const det = e.details ?? {};
    switch (e.type) {
      case "feed": {
        day.feedCount += 1;
        if (det.method === "bottle" && typeof det.amountMl === "number") day.bottleMl += det.amountMl;
        break;
      }
      case "diaper": {
        if (det.kind === "wet") day.diaperWet += 1;
        else if (det.kind === "dirty") day.diaperDirty += 1;
        else if (det.kind === "both") day.diaperBoth += 1;
        break;
      }
      case "pump": {
        const l = typeof det.leftMl === "number" ? det.leftMl : 0;
        const r = typeof det.rightMl === "number" ? det.rightMl : 0;
        day.pumpMl += l + r;
        break;
      }
      case "medicine": day.medicineCount += 1; break;
    }
  }

  const out = [...byDay.values()];
  for (const d of out) {
    d.sleepMinutes = Math.round(d.sleepMinutes);
    d.breastMinutes = Math.round(d.breastMinutes);
  }
  return out;
}
