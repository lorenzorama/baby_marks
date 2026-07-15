"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Sheet from "@/components/Sheet";
import { toast } from "@/components/Toast";
import { useCreateEvent } from "@/hooks/useEvents";
import { useCaregiver } from "@/hooks/useCaregiver";
import { ApiError } from "@/lib/api-client";
import type { CreateEventInput } from "@/lib/types";

type SheetKind = "bottle" | "diaper" | "medicine" | "solids" | null;

export default function ActionGrid() {
  const t = useTranslations();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [caregiver] = useCaregiver();
  const create = useCreateEvent((err) => {
    if (err instanceof ApiError && err.status === 409) toast(t("timer.alreadyRunning"));
    else toast(t("common.error"));
  });

  const [bottleMl, setBottleMl] = useState("90");
  const [medName, setMedName] = useState("");
  const [medDose, setMedDose] = useState("");
  const [food, setFood] = useState("");

  function submit(input: Omit<CreateEventInput, "caregiver">) {
    create.mutate({ ...input, caregiver });
    setSheet(null);
  }
  const nowIso = () => new Date().toISOString();
  const startTimer = (type: "feed" | "sleep" | "pump", details: Record<string, unknown> = {}) =>
    submit({ type, startedAt: nowIso(), endedAt: null, details });
  const point = (type: "diaper" | "medicine" | "feed", details: Record<string, unknown>) => {
    const iso = nowIso();
    submit({ type, startedAt: iso, endedAt: iso, details });
  };

  const btn = "flex flex-col items-center gap-1 rounded-2xl bg-zinc-900 py-4 active:bg-zinc-800";
  const input = "w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none focus:border-sky-500";
  const primary = "w-full rounded-xl bg-sky-600 py-3 font-semibold disabled:opacity-50";

  return (
    <>
      <div className="grid grid-cols-4 gap-2">
        <button className={btn} onClick={() => startTimer("feed", { method: "breast", side: "left" })}>
          <span className="text-2xl">🤱</span><span className="text-xs">{t("actions.nursingLeft")}</span>
        </button>
        <button className={btn} onClick={() => startTimer("feed", { method: "breast", side: "right" })}>
          <span className="text-2xl">🤱</span><span className="text-xs">{t("actions.nursingRight")}</span>
        </button>
        <button className={btn} onClick={() => setSheet("bottle")}>
          <span className="text-2xl">🍼</span><span className="text-xs">{t("actions.bottle")}</span>
        </button>
        <button className={btn} onClick={() => startTimer("sleep")}>
          <span className="text-2xl">😴</span><span className="text-xs">{t("actions.sleep")}</span>
        </button>
        <button className={btn} onClick={() => setSheet("diaper")}>
          <span className="text-2xl">🧷</span><span className="text-xs">{t("actions.diaper")}</span>
        </button>
        <button className={btn} onClick={() => startTimer("pump")}>
          <span className="text-2xl">🥛</span><span className="text-xs">{t("actions.pump")}</span>
        </button>
        <button className={btn} onClick={() => setSheet("medicine")}>
          <span className="text-2xl">💊</span><span className="text-xs">{t("actions.medicine")}</span>
        </button>
        <button className={btn} onClick={() => setSheet("solids")}>
          <span className="text-2xl">🥣</span><span className="text-xs">{t("actions.solids")}</span>
        </button>
      </div>

      <Sheet open={sheet === "bottle"} onClose={() => setSheet(null)} title={t("actions.bottle")}>
        <div className="space-y-3">
          <input type="number" inputMode="numeric" value={bottleMl}
            onChange={(e) => setBottleMl(e.target.value)} placeholder={t("sheets.amountMl")} className={input} />
          <button className={primary} disabled={!Number(bottleMl)}
            onClick={() => point("feed", { method: "bottle", amountMl: Number(bottleMl) })}>
            {t("sheets.save")}
          </button>
        </div>
      </Sheet>

      <Sheet open={sheet === "diaper"} onClose={() => setSheet(null)} title={t("actions.diaper")}>
        <div className="grid grid-cols-3 gap-2">
          {(["wet", "dirty", "both"] as const).map((kind) => (
            <button key={kind} className="rounded-xl bg-zinc-800 py-4 font-medium active:bg-zinc-700"
              onClick={() => point("diaper", { kind })}>
              {t(`diaper.${kind}`)}
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={sheet === "medicine"} onClose={() => setSheet(null)} title={t("actions.medicine")}>
        <div className="space-y-3">
          <input value={medName} onChange={(e) => setMedName(e.target.value)}
            placeholder={t("sheets.medName")} className={input} />
          <input value={medDose} onChange={(e) => setMedDose(e.target.value)}
            placeholder={t("sheets.medDose")} className={input} />
          <button className={primary} disabled={!medName.trim()}
            onClick={() => point("medicine", { name: medName.trim(), ...(medDose.trim() ? { dose: medDose.trim() } : {}) })}>
            {t("sheets.save")}
          </button>
        </div>
      </Sheet>

      <Sheet open={sheet === "solids"} onClose={() => setSheet(null)} title={t("actions.solids")}>
        <div className="space-y-3">
          <input value={food} onChange={(e) => setFood(e.target.value)}
            placeholder={t("sheets.food")} className={input} />
          <button className={primary} disabled={!food.trim()}
            onClick={() => point("feed", { method: "solids", food: food.trim() })}>
            {t("sheets.save")}
          </button>
        </div>
      </Sheet>
    </>
  );
}
