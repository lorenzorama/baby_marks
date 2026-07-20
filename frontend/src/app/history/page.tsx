"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import EventItem from "@/components/EventItem";
import EditEventSheet from "@/components/EditEventSheet";
import { api } from "@/lib/api-client";
import type { ApiEvent, EventType } from "@/lib/types";

const PAGE = 100;
const TYPES: (EventType | null)[] = [null, "feed", "sleep", "diaper", "pump", "medicine"];
const chipLabels: Record<string, string> = {
  feed: "🍼", sleep: "😴", diaper: "🧷", pump: "🥛", medicine: "💊",
};
const chipAriaKeys: Record<string, string> = {
  feed: "timer.feed", sleep: "timer.sleep", diaper: "actions.diaper", pump: "timer.pump", medicine: "actions.medicine",
};

export default function HistoryPage() {
  const t = useTranslations();
  const summaryT = useTranslations("summary");
  const tCg = useTranslations("caregiver");
  const locale = useLocale();
  const [filter, setFilter] = useState<EventType | null>(null);
  const [editing, setEditing] = useState<ApiEvent | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["events", "history", filter],
    queryFn: ({ pageParam }) =>
      api.get<{ events: ApiEvent[] }>(
        `/api/events?limit=${PAGE}${filter ? `&type=${filter}` : ""}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`,
      ),
    initialPageParam: "",
    getNextPageParam: (last) =>
      last.events.length === PAGE ? last.events[last.events.length - 1].startedAt : undefined,
  });

  const events = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p.events),
    [query.data],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, ApiEvent[]>();
    for (const e of events) {
      const day = new Date(e.startedAt).toLocaleDateString(
        locale === "fr" ? "fr-FR" : "en-GB",
        { weekday: "long", day: "numeric", month: "long" },
      );
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(e);
    }
    return [...map.entries()];
  }, [events, locale]);

  return (
    <main className="space-y-4 p-4 pb-28">
      <h1 className="text-xl font-bold">{t("history.title")}</h1>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {TYPES.map((type) => (
          <button
            key={type ?? "all"}
            onClick={() => setFilter(type)}
            aria-label={type ? t(chipAriaKeys[type]) : t("history.all")}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm ${filter === type ? "bg-sky-600" : "bg-zinc-900"}`}
          >
            {type ? chipLabels[type] : t("history.all")}
          </button>
        ))}
      </div>

      {events.length === 0 && !query.isLoading && (
        <p className="text-sm text-zinc-600">{t("history.empty")}</p>
      )}

      {byDay.map(([day, dayEvents]) => (
        <section key={day}>
          <h2 className="mb-2 text-sm font-semibold capitalize text-zinc-400">{day}</h2>
          <div className="space-y-1.5">
            {dayEvents.map((e) => (
              <EventItem key={e.id} event={e} locale={locale} summaryT={summaryT}
                runningLabel={summaryT("running")}
                caregiverLabels={{ maman: tCg("initialMaman"), papa: tCg("initialPapa") }}
                onClick={() => setEditing(e)} />
            ))}
          </div>
        </section>
      ))}

      {query.hasNextPage && (
        <button onClick={() => query.fetchNextPage()}
          className="w-full rounded-xl bg-zinc-900 py-3 text-sm">
          {t("history.loadMore")}
        </button>
      )}

      <EditEventSheet event={editing} onClose={() => setEditing(null)} />
    </main>
  );
}
