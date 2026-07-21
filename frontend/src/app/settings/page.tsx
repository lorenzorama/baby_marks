"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "@/components/Toast";
import { useBaby, useSaveBaby } from "@/hooks/useBaby";
import { useCaregiver } from "@/hooks/useCaregiver";

const SCREEN = "space-y-6 p-5 pb-28";
const CARD = "rounded-3xl bg-surface p-4 shadow-sm";
const INPUT = "w-full rounded-2xl border border-line bg-surface-2 px-4 py-3.5 text-base text-ink outline-none focus:border-primary";
const PRIMARY_BTN = "w-full rounded-2xl bg-primary py-3.5 text-base font-bold text-white disabled:opacity-50";
const LABEL = "mb-1 block text-sm font-medium text-ink-soft";
const SEG_ON = "flex-1 rounded-2xl bg-primary py-3 font-semibold text-white";
const SEG_OFF = "flex-1 rounded-2xl bg-surface-2 py-3 font-semibold text-ink-soft";

function SectionHeader({ icon, tint, title }: { icon: string; tint: string; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className={`flex h-9 w-9 items-center justify-center rounded-full text-lg ${tint}`}>{icon}</span>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
    </div>
  );
}

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("caregiver");
  const locale = useLocale();
  const { data: baby } = useBaby();
  const saveBaby = useSaveBaby();
  const [caregiver, setCaregiver] = useCaregiver();

  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");

  useEffect(() => {
    if (baby) { setName(baby.name); setBirthDate(baby.birthDate); }
  }, [baby]);

  function setLocale(next: "fr" | "en") {
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000`;
    window.location.reload();
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <main className={SCREEN}>
      <h1 className="text-2xl font-bold text-ink">{t("title")}</h1>

      <section className={CARD}>
        <SectionHeader icon="👶" tint="bg-feed-tint" title={t("babySection")} />
        <div className="space-y-3">
          <div>
            <label className={LABEL}>{t("name")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>{t("birthDate")}</label>
            <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)}
              className={INPUT} />
          </div>
          <button
            disabled={!name.trim() || !birthDate || saveBaby.isPending}
            onClick={() =>
              saveBaby.mutate(
                { name: name.trim(), birthDate, exists: !!baby },
                { onSuccess: () => toast(t("saved"), "success") },
              )}
            className={PRIMARY_BTN}>
            {t("save")}
          </button>
        </div>
      </section>

      <section className={CARD}>
        <SectionHeader icon="💛" tint="bg-medicine-tint" title={t("caregiverSection")} />
        <div className="flex gap-2">
          <button className={caregiver === "maman" ? SEG_ON : SEG_OFF} onClick={() => setCaregiver("maman")}>{tc("maman")}</button>
          <button className={caregiver === "papa" ? SEG_ON : SEG_OFF} onClick={() => setCaregiver("papa")}>{tc("papa")}</button>
        </div>
      </section>

      <section className={CARD}>
        <SectionHeader icon="🌍" tint="bg-growth-tint" title={t("languageSection")} />
        <div className="flex gap-2">
          <button className={locale === "fr" ? SEG_ON : SEG_OFF} onClick={() => setLocale("fr")}>Français</button>
          <button className={locale === "en" ? SEG_ON : SEG_OFF} onClick={() => setLocale("en")}>English</button>
        </div>
      </section>

      <button onClick={logout} className="min-h-[48px] w-full rounded-2xl bg-surface py-3.5 font-semibold text-danger shadow-sm">
        {t("logout")}
      </button>
    </main>
  );
}
