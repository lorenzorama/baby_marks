"use client";

import { useTranslations } from "next-intl";
import { useNow } from "@/hooks/useNow";
import { useUpdateEvent } from "@/hooks/useEvents";
import { formatClock } from "@/lib/format";
import type { ApiEvent } from "@/lib/types";

const icons: Record<string, string> = { feed: "🍼", sleep: "😴", pump: "🥛" };

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
          <div key={e.id} className="flex items-center gap-3 rounded-2xl border border-sky-800 bg-sky-950/40 p-3">
            <span className="text-2xl">{icons[e.type] ?? "⏱"}</span>
            <div className="flex-1">
              <div className="text-sm font-medium">
                {label}{side ? ` · ${ts(side)}` : ""}
              </div>
              <div className="font-mono text-2xl tabular-nums">{formatClock(secs)}</div>
            </div>
            <button
              onClick={() => update.mutate({ id: e.id, endedAt: new Date().toISOString() })}
              className="rounded-xl bg-sky-600 px-5 py-3 font-semibold active:bg-sky-700"
            >
              {t("stop")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
