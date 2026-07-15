"use client";

import { useTranslations } from "next-intl";
import { useNow } from "@/hooks/useNow";
import { formatDuration } from "@/lib/format";
import type { ApiEvent } from "@/lib/types";

function since(now: Date, iso: string): number {
  return (now.getTime() - new Date(iso).getTime()) / 60_000;
}

export default function TimeSinceCards({ events }: { events: ApiEvent[] }) {
  const t = useTranslations("timeSince");
  const now = useNow(30_000);

  const lastFeed = events.find((e) => e.type === "feed");
  const lastSleep = events.find((e) => e.type === "sleep" && e.endedAt !== null);
  const lastDiaper = events.find((e) => e.type === "diaper");

  const cards = [
    { label: t("lastFeed"), ref: lastFeed ? (lastFeed.endedAt ?? lastFeed.startedAt) : null },
    { label: t("lastSleep"), ref: lastSleep ? lastSleep.endedAt : null },
    { label: t("lastDiaper"), ref: lastDiaper ? lastDiaper.startedAt : null },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl bg-zinc-900 p-3 text-center">
          <div className="text-xs text-zinc-500">{c.label}</div>
          <div className="mt-1 text-sm font-semibold">
            {c.ref ? t("ago", { duration: formatDuration(since(now, c.ref)) }) : t("never")}
          </div>
        </div>
      ))}
    </div>
  );
}
