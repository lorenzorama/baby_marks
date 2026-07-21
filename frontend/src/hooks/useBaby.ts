"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Baby } from "@/lib/types";

export function useBaby() {
  return useQuery<Baby | null>({
    queryKey: ["baby"],
    queryFn: async () => (await api.get<{ baby: Baby | null }>("/api/baby")).baby,
    staleTime: 5 * 60_000,
  });
}

export function useSaveBaby() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; birthDate: string; exists: boolean }) => {
      const { exists, ...body } = input;
      return exists
        ? api.patch<{ baby: Baby }>("/api/baby", body)
        : api.post<{ baby: Baby }>("/api/baby", body);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["baby"] }),
  });
}
