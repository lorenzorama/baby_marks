"use client";

import { useTranslations } from "next-intl";

export default function HomePage() {
  const t = useTranslations("nav");
  return <main className="p-4 pb-24">{t("home")}</main>;
}
