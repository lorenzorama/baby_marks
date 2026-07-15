"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

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
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 text-center">
        <div className="text-5xl">🍼</div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={t("placeholder")}
          autoFocus
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-center outline-none focus:border-sky-500"
        />
        {error && <p className="text-sm text-red-400">{t("error")}</p>}
        <button
          type="submit"
          disabled={busy || secret.length === 0}
          className="w-full rounded-xl bg-sky-600 py-3 font-semibold disabled:opacity-50"
        >
          {t("submit")}
        </button>
      </form>
    </main>
  );
}
