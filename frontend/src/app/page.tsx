"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import RunningTimers from "@/components/RunningTimers";
import ActionGrid from "@/components/ActionGrid";
import TimeSinceCards from "@/components/TimeSinceCards";
import EventItem from "@/components/EventItem";
import EditEventSheet from "@/components/EditEventSheet";
import { useRecentEvents } from "@/hooks/useEvents";
import { useBaby } from "@/hooks/useBaby";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import type { ApiEvent } from "@/lib/types";

export default function HomePage() {
  const t = useTranslations();
  const summaryT = useTranslations("summary");
  const tCg = useTranslations("caregiver");
  const locale = useLocale();
  const { mode } = useLayoutMode();
  const { data: baby, isLoading: babyLoading } = useBaby();
  const { data } = useRecentEvents();
  const [editing, setEditing] = useState<ApiEvent | null>(null);

  const events = data?.events ?? [];
  const running = data?.running ?? [];
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const today = events.filter((e) => new Date(e.startedAt) >= todayStart);

  if (!babyLoading && baby === null) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-feed-tint text-5xl">👶</div>
        <h1 className="text-2xl font-bold">{t("onboarding.title")}</h1>
        <p className="text-base text-ink-soft">{t("onboarding.text")}</p>
        <Link href="/settings" className="rounded-2xl bg-primary px-8 py-4 text-base font-bold text-white">
          {t("onboarding.cta")}
        </Link>
      </main>
    );
  }

  const actionsColumn = (
    <>
      <RunningTimers running={running} />
      <ActionGrid />
    </>
  );

  const timelineColumn = (
    <>
      <TimeSinceCards events={events} />
      <section>
        <h2 className="mb-2 text-base font-semibold text-ink">{t("timeline.today")}</h2>
        {today.length === 0 ? (
          <p className="text-sm text-ink-soft">{t("timeline.empty")}</p>
        ) : (
          <div className="space-y-1.5">
            {today.map((e) => (
              <EventItem key={e.id} event={e} locale={locale} summaryT={summaryT}
                runningLabel={summaryT("running")}
                caregiverLabels={{ maman: tCg("initialMaman"), papa: tCg("initialPapa") }}
                onClick={() => setEditing(e)} />
            ))}
          </div>
        )}
      </section>
    </>
  );

  return (
    <main className={mode === "web" ? "mx-auto max-w-5xl p-6 pb-10" : "space-y-6 p-5 pb-28"}>
      {mode === "web" ? (
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-6">{actionsColumn}</div>
          <div className="space-y-6">{timelineColumn}</div>
        </div>
      ) : (
        <>
          {actionsColumn}
          {timelineColumn}
        </>
      )}

      <EditEventSheet event={editing} onClose={() => setEditing(null)} />
    </main>
  );
}
