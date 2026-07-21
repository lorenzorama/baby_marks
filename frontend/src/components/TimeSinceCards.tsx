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

  const lastFeed = events.find((e) => e.type === "feed" && e.endedAt !== null);
  const lastSleep = events.find((e) => e.type === "sleep" && e.endedAt !== null);
  const lastDiaper = events.find((e) => e.type === "diaper");

  const cards = [
    { label: t("lastFeed"), ref: lastFeed ? lastFeed.endedAt : null, icon: "🍼", tint: "bg-feed-tint" },
    { label: t("lastSleep"), ref: lastSleep ? lastSleep.endedAt : null, icon: "😴", tint: "bg-sleep-tint" },
    { label: t("lastDiaper"), ref: lastDiaper ? lastDiaper.startedAt : null, icon: "🧷", tint: "bg-diaper-tint" },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {cards.map((c) => (
        <div key={c.label} className="rounded-3xl bg-surface p-3 text-center shadow-sm">
          <span className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full text-lg ${c.tint}`}>
            {c.icon}
          </span>
          <div className="mt-1.5 text-xs font-medium text-ink-soft">{c.label}</div>
          <div className="text-base font-bold text-ink">
            {c.ref ? t("ago", { duration: formatDuration(since(now, c.ref)) }) : t("never")}
          </div>
        </div>
      ))}
    </div>
  );
}
