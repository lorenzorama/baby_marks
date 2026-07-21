"use client";

import { useEffect, useState } from "react";
import type { Caregiver } from "@/lib/types";

export function useCaregiver(): [Caregiver, (c: Caregiver) => void] {
  const [caregiver, setCaregiver] = useState<Caregiver>("maman");
  useEffect(() => {
    const stored = localStorage.getItem("bm_caregiver");
    if (stored === "papa" || stored === "maman") setCaregiver(stored);
  }, []);
  const update = (c: Caregiver) => {
    setCaregiver(c);
    localStorage.setItem("bm_caregiver", c);
  };
  return [caregiver, update];
}
