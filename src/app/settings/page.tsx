"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "@/components/Toast";
import { useBaby, useSaveBaby } from "@/hooks/useBaby";
import { useCaregiver } from "@/hooks/useCaregiver";

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

  const input = "w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 outline-none focus:border-sky-500";
  const section = "rounded-2xl bg-zinc-900/60 p-4";
  const segBtn = (active: boolean) =>
    `flex-1 rounded-xl py-2.5 font-medium ${active ? "bg-sky-600" : "bg-zinc-800"}`;

  return (
    <main className="space-y-4 p-4 pb-28">
      <h1 className="text-xl font-bold">{t("title")}</h1>

      <section className={section}>
        <h2 className="mb-3 text-sm font-semibold text-zinc-400">{t("babySection")}</h2>
        <div className="space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder={t("name")} className={input} />
          <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)}
            className={input} />
          <button
            disabled={!name.trim() || !birthDate || saveBaby.isPending}
            onClick={() =>
              saveBaby.mutate(
                { name: name.trim(), birthDate, exists: !!baby },
                { onSuccess: () => toast(t("saved"), "success") },
              )}
            className="w-full rounded-xl bg-sky-600 py-3 font-semibold disabled:opacity-50">
            {t("save")}
          </button>
        </div>
      </section>

      <section className={section}>
        <h2 className="mb-3 text-sm font-semibold text-zinc-400">{t("caregiverSection")}</h2>
        <div className="flex gap-2">
          <button className={segBtn(caregiver === "maman")} onClick={() => setCaregiver("maman")}>{tc("maman")}</button>
          <button className={segBtn(caregiver === "papa")} onClick={() => setCaregiver("papa")}>{tc("papa")}</button>
        </div>
      </section>

      <section className={section}>
        <h2 className="mb-3 text-sm font-semibold text-zinc-400">{t("languageSection")}</h2>
        <div className="flex gap-2">
          <button className={segBtn(locale === "fr")} onClick={() => setLocale("fr")}>Français</button>
          <button className={segBtn(locale === "en")} onClick={() => setLocale("en")}>English</button>
        </div>
      </section>

      <button onClick={logout} className="w-full rounded-xl bg-zinc-900 py-3 font-semibold text-red-400">
        {t("logout")}
      </button>
    </main>
  );
}
