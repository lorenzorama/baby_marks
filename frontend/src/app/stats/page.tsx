"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import BarChart from "@/components/BarChart";
import LineChart from "@/components/LineChart";
import { useStats } from "@/hooks/useStats";
import { useCreateMeasurement, useMeasurements } from "@/hooks/useMeasurements";

const SCREEN = "space-y-6 p-5 pb-28";
const CARD = "rounded-3xl bg-surface p-4 shadow-sm";
const INPUT = "w-full rounded-2xl border border-line bg-surface-2 px-4 py-3.5 text-base text-ink outline-none focus:border-primary";
const PRIMARY_BTN = "w-full rounded-2xl bg-primary py-3.5 text-base font-bold text-white disabled:opacity-50";
const LABEL = "mb-1 block text-sm font-medium text-ink-soft";

function SectionHeader({ icon, tint, title }: { icon: string; tint: string; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className={`flex h-9 w-9 items-center justify-center rounded-full text-lg ${tint}`}>{icon}</span>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
    </div>
  );
}

export default function StatsPage() {
  const t = useTranslations("stats");
  const locale = useLocale();
  const { data: days } = useStats(7);
  const { data: measurements } = useMeasurements();
  const createMeasurement = useCreateMeasurement();

  const [date, setDate] = useState(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
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
    if (Number(weight) > 0) body.weightG = Math.round(Number(weight) * 1000);
    if (Number(height) > 0) body.heightMm = Math.round(Number(height) * 10);
    if (Number(head) > 0) body.headCircMm = Math.round(Number(head) * 10);
    createMeasurement.mutate(body, {
      onSuccess: () => { setWeight(""); setHeight(""); setHead(""); },
    });
  }

  return (
    <main className={SCREEN}>
      <h1 className="text-2xl font-bold text-ink">{t("title")}</h1>

      <section className={CARD}>
        <SectionHeader icon="😴" tint="bg-sleep-tint" title={t("sleepPerDay")} />
        <BarChart data={chart((d) => Math.round((d.sleepMinutes / 60) * 10) / 10)} color="bg-sleep" />
      </section>
      <section className={CARD}>
        <SectionHeader icon="🍼" tint="bg-feed-tint" title={t("feedsPerDay")} />
        <BarChart data={chart((d) => d.feedCount)} color="bg-feed" />
      </section>
      <section className={CARD}>
        <SectionHeader icon="🍼" tint="bg-feed-tint" title={t("bottleMlPerDay")} />
        <BarChart data={chart((d) => d.bottleMl)} color="bg-feed" />
      </section>
      <section className={CARD}>
        <SectionHeader icon="🧷" tint="bg-diaper-tint" title={t("diapersPerDay")} />
        <BarChart data={chart((d) => d.diaperWet + d.diaperDirty + d.diaperBoth)} color="bg-diaper" />
      </section>
      <section className={CARD}>
        <SectionHeader icon="🥛" tint="bg-pump-tint" title={t("pumpMlPerDay")} />
        <BarChart data={chart((d) => d.pumpMl)} color="bg-pump" />
      </section>

      <section className={CARD}>
        <SectionHeader icon="📏" tint="bg-growth-tint" title={t("growth")} />
        {weightPoints.length >= 2 ? (
          <>
            <p className="text-xs font-medium text-ink-soft">{t("weight")}</p>
            <LineChart points={weightPoints} />
          </>
        ) : (
          <p className="text-sm text-ink-soft">{t("needTwoPoints")}</p>
        )}
        {heightPoints.length >= 2 && (
          <>
            <p className="mt-2 text-xs font-medium text-ink-soft">{t("height")}</p>
            <LineChart points={heightPoints} />
          </>
        )}
      </section>

      <section className={CARD}>
        <SectionHeader icon="📏" tint="bg-growth-tint" title={t("addMeasurement")} />
        <div className="space-y-3">
          <div>
            <label className={LABEL}>{t("date")}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>{t("weightKg")}</label>
            <input type="number" inputMode="decimal" step="0.01" min="0"
              value={weight} onChange={(e) => setWeight(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>{t("heightCm")}</label>
            <input type="number" inputMode="decimal" step="0.1" min="0"
              value={height} onChange={(e) => setHeight(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>{t("headCm")}</label>
            <input type="number" inputMode="decimal" step="0.1" min="0"
              value={head} onChange={(e) => setHead(e.target.value)} className={INPUT} />
          </div>
          <button onClick={saveMeasurement}
            disabled={!(Number(weight) > 0) && !(Number(height) > 0) && !(Number(head) > 0)}
            className={PRIMARY_BTN}>
            {t("save")}
          </button>
        </div>
      </section>
    </main>
  );
}
