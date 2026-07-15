"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import BarChart from "@/components/BarChart";
import LineChart from "@/components/LineChart";
import { useStats } from "@/hooks/useStats";
import { useCreateMeasurement, useMeasurements } from "@/hooks/useMeasurements";

export default function StatsPage() {
  const t = useTranslations("stats");
  const locale = useLocale();
  const { data: days } = useStats(7);
  const { data: measurements } = useMeasurements();
  const createMeasurement = useCreateMeasurement();

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [head, setHead] = useState("");

  const dayLabel = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { weekday: "narrow" });

  const chart = (fn: (d: NonNullable<typeof days>[number]) => number) =>
    (days ?? []).map((d) => ({ label: dayLabel(d.date), value: fn(d) }));

  const weightPoints = (measurements ?? [])
    .filter((m) => m.weightG != null)
    .map((m) => ({ label: m.measuredAt.slice(5), value: Math.round((m.weightG! / 1000) * 100) / 100 }));
  const heightPoints = (measurements ?? [])
    .filter((m) => m.heightMm != null)
    .map((m) => ({ label: m.measuredAt.slice(5), value: Math.round(m.heightMm! / 10) }));

  function saveMeasurement() {
    const body: Record<string, unknown> = { measuredAt: date };
    if (Number(weight)) body.weightG = Math.round(Number(weight) * 1000);
    if (Number(height)) body.heightMm = Math.round(Number(height) * 10);
    if (Number(head)) body.headCircMm = Math.round(Number(head) * 10);
    createMeasurement.mutate(body);
    setWeight(""); setHeight(""); setHead("");
  }

  const input = "w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 outline-none focus:border-sky-500";
  const section = "rounded-2xl bg-zinc-900/60 p-4";

  return (
    <main className="space-y-4 p-4 pb-28">
      <h1 className="text-xl font-bold">{t("title")}</h1>

      <section className={section}>
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">{t("sleepPerDay")}</h2>
        <BarChart data={chart((d) => Math.round((d.sleepMinutes / 60) * 10) / 10)} color="bg-indigo-500" />
      </section>
      <section className={section}>
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">{t("feedsPerDay")}</h2>
        <BarChart data={chart((d) => d.feedCount)} />
      </section>
      <section className={section}>
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">{t("bottleMlPerDay")}</h2>
        <BarChart data={chart((d) => d.bottleMl)} color="bg-teal-500" />
      </section>
      <section className={section}>
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">{t("diapersPerDay")}</h2>
        <BarChart data={chart((d) => d.diaperWet + d.diaperDirty + d.diaperBoth)} color="bg-amber-500" />
      </section>
      <section className={section}>
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">{t("pumpMlPerDay")}</h2>
        <BarChart data={chart((d) => d.pumpMl)} color="bg-pink-500" />
      </section>

      <section className={section}>
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">{t("growth")}</h2>
        {weightPoints.length >= 2 ? (
          <>
            <p className="text-xs text-zinc-500">{t("weight")}</p>
            <LineChart points={weightPoints} />
          </>
        ) : (
          <p className="text-sm text-zinc-600">{t("needTwoPoints")}</p>
        )}
        {heightPoints.length >= 2 && (
          <>
            <p className="mt-2 text-xs text-zinc-500">{t("height")}</p>
            <LineChart points={heightPoints} />
          </>
        )}
      </section>

      <section className={section}>
        <h2 className="mb-3 text-sm font-semibold text-zinc-400">{t("addMeasurement")}</h2>
        <div className="space-y-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
          <input type="number" inputMode="decimal" step="0.01" placeholder={t("weightKg")}
            value={weight} onChange={(e) => setWeight(e.target.value)} className={input} />
          <input type="number" inputMode="decimal" step="0.1" placeholder={t("heightCm")}
            value={height} onChange={(e) => setHeight(e.target.value)} className={input} />
          <input type="number" inputMode="decimal" step="0.1" placeholder={t("headCm")}
            value={head} onChange={(e) => setHead(e.target.value)} className={input} />
          <button onClick={saveMeasurement}
            disabled={!Number(weight) && !Number(height) && !Number(head)}
            className="w-full rounded-xl bg-sky-600 py-3 font-semibold disabled:opacity-50">
            {t("save")}
          </button>
        </div>
      </section>
    </main>
  );
}
