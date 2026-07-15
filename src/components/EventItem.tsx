"use client";

import { formatDuration, formatTime } from "@/lib/format";
import type { ApiEvent } from "@/lib/types";

const icons: Record<string, string> = {
  feed: "🍼", sleep: "😴", diaper: "🧷", pump: "🥛", medicine: "💊",
};

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
      className="flex w-full items-center gap-3 rounded-xl bg-zinc-900 px-3 py-2.5 text-left active:bg-zinc-800"
    >
      <span className="text-xl">{icons[event.type]}</span>
      <span className="flex-1">
        <span className="block text-sm">{summarize(event, summaryT)}</span>
        <span className="block text-xs text-zinc-500">
          {formatTime(event.startedAt, locale)}
          {event.endedAt === null && ` · ${runningLabel}`}
          {dur !== null && ` · ${formatDuration(dur)}`}
        </span>
      </span>
      <span className="text-xs text-zinc-600">{caregiverLabels[event.caregiver]}</span>
    </button>
  );
}
