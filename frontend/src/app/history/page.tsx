"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import EventItem from "@/components/EventItem";
import EditEventSheet from "@/components/EditEventSheet";
import { api } from "@/lib/api-client";
import { activityIcon, activityTint, activityAccentText } from "@/lib/activity";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import type { ApiEvent, EventType } from "@/lib/types";

const PAGE = 100;
const TYPES: (EventType | null)[] = [null, "feed", "sleep", "diaper", "pump", "medicine"];

export default function HistoryPage() {
  const t = useTranslations();
  const summaryT = useTranslations("summary");
  const tCg = useTranslations("caregiver");
  const tt = useTranslations("types");
  const locale = useLocale();
  const { mode } = useLayoutMode();
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
    <main className={mode === "web" ? "mx-auto max-w-2xl p-6 pb-10 space-y-6" : "space-y-6 p-5 pb-28"}>
      <h1 className="text-2xl font-bold">{t("history.title")}</h1>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {TYPES.map((type) => {
          const active = filter === type;
          const className = type
            ? active
              ? `flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold ${activityTint[type]} ${activityAccentText[type]}`
              : "flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-surface px-4 py-2 text-sm font-semibold text-ink-soft shadow-sm"
            : active
              ? "flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold bg-primary/15 text-primary"
              : "flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-surface px-4 py-2 text-sm font-semibold text-ink-soft shadow-sm";
          return (
            <button key={type ?? "all"} onClick={() => setFilter(type)} className={className}>
              {type ? (
                <>
                  <span>{activityIcon[type]}</span>
                  {tt(type)}
                </>
              ) : (
                t("history.all")
              )}
            </button>
          );
        })}
      </div>

      {events.length === 0 && !query.isLoading && (
        <p className="text-sm text-ink-soft">{t("history.empty")}</p>
      )}

      {byDay.map(([day, dayEvents]) => (
        <section key={day}>
          <h2 className="mb-2 text-base font-bold capitalize text-ink">{day}</h2>
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
          className="w-full min-h-[48px] rounded-2xl bg-surface py-3 text-sm font-semibold text-ink-soft shadow-sm">
          {t("history.loadMore")}
        </button>
      )}

      <EditEventSheet event={editing} onClose={() => setEditing(null)} />
    </main>
  );
}
