"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLayoutMode, LayoutSetting } from "@/hooks/useLayoutMode";

const settings: LayoutSetting[] = ["auto", "mobile", "web"];
const tabs = [
  { href: "/", key: "home" },
  { href: "/history", key: "history" },
  { href: "/stats", key: "stats" },
  { href: "/settings", key: "settings" },
] as const;

export default function TopBar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tm = useTranslations("mode");
  const { setting, mode, setSetting } = useLayoutMode();
  if (pathname === "/login") return null;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2 text-base font-bold">
          <span className="text-xl">🍼</span>
          <span>Baby Marks</span>
        </div>
        {mode === "web" && (
          <nav className="flex items-center gap-1">
            {tabs.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${pathname === tab.href ? "bg-primary/15 text-primary" : "text-ink-soft"}`}
              >
                {t(tab.key)}
              </Link>
            ))}
          </nav>
        )}
        <div className="flex items-center rounded-full bg-surface-2 p-1">
          {settings.map((s) => (
            <button
              key={s}
              onClick={() => setSetting(s)}
              className={`min-h-[36px] rounded-full px-3 text-xs font-semibold ${setting === s ? "bg-primary text-white" : "text-ink-soft"}`}
            >
              {tm(s)}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
