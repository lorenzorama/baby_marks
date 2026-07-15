"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const tabs = [
  { href: "/", key: "home", icon: "🏠" },
  { href: "/history", key: "history", icon: "📖" },
  { href: "/stats", key: "stats", icon: "📊" },
  { href: "/settings", key: "settings", icon: "⚙️" },
] as const;

export default function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  if (pathname === "/login") return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-zinc-800 bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex flex-col items-center gap-0.5 py-2 text-xs ${active ? "text-sky-400" : "text-zinc-500"}`}
          >
            <span className="text-xl">{tab.icon}</span>
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
