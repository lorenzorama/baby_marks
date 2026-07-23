"use client";

import { useTranslations } from "next-intl";
import { useNow } from "@/hooks/useNow";
import { useUpdateEvent } from "@/hooks/useEvents";
import { formatClock } from "@/lib/format";
import { activityIcon, activityTint, activityAccentBg } from "@/lib/activity";
import type { ApiEvent } from "@/lib/types";

export default function RunningTimers({ running }: { running: ApiEvent[] }) {
  const t = useTranslations("timer");
  const ts = useTranslations("side");
  const now = useNow(1000);
  const update = useUpdateEvent();
  if (running.length === 0) return null;
  return (
    <div className="space-y-2">
      {running.map((e) => {
        const secs = (now.getTime() - new Date(e.startedAt).getTime()) / 1000;
        const label = e.type === "feed" ? t("feed") : e.type === "sleep" ? t("sleep") : t("pump");
        const side = (e.details as { side?: string }).side;
        return (
          <div key={e.id} className={`flex items-center gap-3 rounded-3xl p-5 ${activityTint[e.type]}`}>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface text-2xl">
              {activityIcon[e.type] ?? "⏱"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink-soft">
                {label}{side ? ` · ${ts(side)}` : ""}
              </div>
              <div className="truncate font-mono text-3xl font-bold tabular-nums">{formatClock(secs)}</div>
            </div>
            <button
              onClick={() => update.mutate({ id: e.id, endedAt: new Date().toISOString() })}
              className={`min-h-[56px] rounded-2xl px-6 py-4 text-lg font-bold text-white active:opacity-90 ${activityAccentBg[e.type]}`}
            >
              {t("stop")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
