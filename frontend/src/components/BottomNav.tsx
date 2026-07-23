"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLayoutMode } from "@/hooks/useLayoutMode";

const tabs = [
  { href: "/", key: "home", icon: "🏠" },
  { href: "/history", key: "history", icon: "📖" },
  { href: "/stats", key: "stats", icon: "📊" },
  { href: "/settings", key: "settings", icon: "⚙️" },
] as const;

export default function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const { mode } = useLayoutMode();
  if (pathname === "/login") return null;
  if (mode === "web") return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="flex min-h-[64px] flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium"
          >
            <span
              className={`flex h-9 w-14 items-center justify-center rounded-full text-2xl ${active ? "bg-primary/15" : ""}`}
            >
              {tab.icon}
            </span>
            <span className={active ? "text-primary" : "text-ink-soft"}>{t(tab.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
