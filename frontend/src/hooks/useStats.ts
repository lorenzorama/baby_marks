"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { DayStats } from "@/lib/types";

export function useStats(days = 7) {
  const tzOffset = new Date().getTimezoneOffset();
  return useQuery<DayStats[]>({
    queryKey: ["stats", days, tzOffset],
    queryFn: async () =>
      (await api.get<{ days: DayStats[] }>(`/api/stats?days=${days}&tzOffset=${tzOffset}`)).days,
  });
}
