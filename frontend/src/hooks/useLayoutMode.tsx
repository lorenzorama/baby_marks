"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type LayoutSetting = "auto" | "mobile" | "web";
export type LayoutMode = "mobile" | "web";

const KEY = "bm_layout";
const QUERY = "(min-width: 768px)";

const Ctx = createContext<{
  setting: LayoutSetting;
  mode: LayoutMode;
  setSetting: (s: LayoutSetting) => void;
}>({ setting: "auto", mode: "mobile", setSetting: () => {} });

export function LayoutModeProvider({ children }: { children: React.ReactNode }) {
  const [setting, setSettingState] = useState<LayoutSetting>("auto");
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    if (stored === "mobile" || stored === "web" || stored === "auto") setSettingState(stored);
    const mq = window.matchMedia(QUERY);
    setWide(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setSetting = (s: LayoutSetting) => {
    setSettingState(s);
    localStorage.setItem(KEY, s);
  };

  const mode: LayoutMode = setting === "auto" ? (wide ? "web" : "mobile") : setting;
  return <Ctx.Provider value={{ setting, mode, setSetting }}>{children}</Ctx.Provider>;
}

export function useLayoutMode() {
  return useContext(Ctx);
}
