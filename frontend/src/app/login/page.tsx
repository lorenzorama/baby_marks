"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

const INPUT = "w-full rounded-2xl border border-line bg-surface-2 px-4 py-3.5 text-base text-ink outline-none focus:border-primary";
const PRIMARY_BTN = "w-full rounded-2xl bg-primary py-3.5 text-base font-bold text-white disabled:opacity-50";

export default function LoginPage() {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const t = useTranslations("login");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-3xl bg-surface p-6 text-center shadow-sm">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-feed-tint text-4xl">🍼</div>
        <h1 className="text-3xl font-bold text-ink">{t("title")}</h1>
        <p className="text-sm text-ink-soft">{t("subtitle")}</p>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={t("placeholder")}
          autoFocus
          autoComplete="current-password"
          className={`${INPUT} min-h-[56px] text-center`}
        />
        {error && (
          <p className="rounded-2xl bg-danger/10 px-4 py-2.5 text-sm font-medium text-danger">{t("error")}</p>
        )}
        <button
          type="submit"
          disabled={busy || secret.length === 0}
          className={`${PRIMARY_BTN} min-h-[52px]`}
        >
          {t("submit")}
        </button>
      </form>
    </main>
  );
}
