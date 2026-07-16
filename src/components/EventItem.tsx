"use client";

import { formatDuration, formatTime } from "@/lib/format";
import { activityIcon, activityTint } from "@/lib/activity";
import type { ApiEvent } from "@/lib/types";

type Tsum = (key: string, values?: Record<string, string | number>) => string;

export function summarize(e: ApiEvent, t: Tsum): string {
  const det = e.details as Record<string, unknown>;
  switch (e.type) {
    case "feed":
      if (det.method === "bottle") return t("bottle", { ml: (det.amountMl as number) ?? 0 });
      if (det.method === "solids") return t("solids", { food: (det.food as string) ?? "" });
      if (det.side === "left") return t("breastLeft");
      if (det.side === "right") return t("breastRight");
      return t("breast");
    case "sleep": return t("sleep");
    case "diaper":
      if (det.kind === "dirty") return t("diaperDirty");
      if (det.kind === "both") return t("diaperBoth");
      return t("diaperWet");
    case "pump": {
      const ml = ((det.leftMl as number) ?? 0) + ((det.rightMl as number) ?? 0);
      return t("pump", { ml });
    }
    case "medicine": return t("medicine", { name: (det.name as string) ?? "" });
    default: return e.type;
  }
}

export function durationOf(e: ApiEvent): number | null {
  if (!e.endedAt || e.endedAt === e.startedAt) return null;
  const min = (new Date(e.endedAt).getTime() - new Date(e.startedAt).getTime()) / 60_000;
  return min >= 1 ? min : null;
}

export default function EventItem({
  event, locale, summaryT, runningLabel, caregiverLabels, onClick,
}: {
  event: ApiEvent;
  locale: string;
  summaryT: Tsum;
  runningLabel: string;
  caregiverLabels: { maman: string; papa: string };
  onClick?: () => void;
}) {
  const dur = durationOf(event);
  return (
    <button
      onClick={onClick}
      className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl bg-surface px-3 py-3 text-left shadow-sm active:bg-surface-2"
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl ${activityTint[event.type]}`}>
        {activityIcon[event.type]}
      </span>
      <span className="flex-1">
        <span className="block text-base font-medium">{summarize(event, summaryT)}</span>
        <span className="block text-sm text-ink-soft">
          {formatTime(event.startedAt, locale)}
          {event.endedAt === null && ` · ${runningLabel}`}
          {dur !== null && ` · ${formatDuration(dur)}`}
        </span>
      </span>
      <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-soft">{caregiverLabels[event.caregiver]}</span>
    </button>
  );
}
