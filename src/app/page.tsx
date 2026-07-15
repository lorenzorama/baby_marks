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
import type { ApiEvent } from "@/lib/types";

export default function HomePage() {
  const t = useTranslations();
  const summaryT = useTranslations("summary");
  const tCg = useTranslations("caregiver");
  const locale = useLocale();
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
        <div className="text-5xl">👶</div>
        <h1 className="text-xl font-bold">{t("onboarding.title")}</h1>
        <p className="text-zinc-400">{t("onboarding.text")}</p>
        <Link href="/settings" className="rounded-xl bg-sky-600 px-6 py-3 font-semibold">
          {t("onboarding.cta")}
        </Link>
      </main>
    );
  }

  return (
    <main className="space-y-4 p-4 pb-28">
      <RunningTimers running={running} />
      <ActionGrid />
      <TimeSinceCards events={events} />
      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">{t("timeline.today")}</h2>
        {today.length === 0 ? (
          <p className="text-sm text-zinc-600">{t("timeline.empty")}</p>
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

      <EditEventSheet event={editing} onClose={() => setEditing(null)} />
    </main>
  );
}
