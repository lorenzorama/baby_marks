"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { toast } from "@/components/Toast";
import type { Measurement } from "@/lib/types";

export function useMeasurements() {
  return useQuery<Measurement[]>({
    queryKey: ["measurements"],
    queryFn: async () =>
      (await api.get<{ measurements: Measurement[] }>("/api/measurements")).measurements,
  });
}

export function useCreateMeasurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.post<{ measurement: Measurement }>("/api/measurements", input),
    onError: (err) => toast(err instanceof Error ? err.message : "error"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["measurements"] }),
  });
}

export function useDeleteMeasurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/api/measurements/${id}`),
    onError: (err) => toast(err instanceof Error ? err.message : "error"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["measurements"] }),
  });
}
