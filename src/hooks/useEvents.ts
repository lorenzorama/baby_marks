"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { toast } from "@/components/Toast";
import type { ApiEvent, CreateEventInput } from "@/lib/types";

export type RecentData = { events: ApiEvent[]; running: ApiEvent[] };

const RECENT_KEY = ["events", "recent"] as const;

export function useRecentEvents() {
  return useQuery<RecentData>({
    queryKey: RECENT_KEY,
    queryFn: () => api.get<RecentData>("/api/events?limit=100"),
    refetchInterval: 30_000,
  });
}

export function useCreateEvent(onApiError?: (err: unknown) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInput) =>
      api.post<{ event: ApiEvent }>("/api/events", input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: RECENT_KEY });
      const prev = qc.getQueryData<RecentData>(RECENT_KEY);
      if (prev) {
        const temp: ApiEvent = {
          id: -Date.now(), babyId: 0, type: input.type,
          startedAt: input.startedAt, endedAt: input.endedAt ?? null,
          details: input.details ?? {}, note: input.note ?? null,
          caregiver: input.caregiver,
        };
        qc.setQueryData<RecentData>(RECENT_KEY, {
          events: [temp, ...prev.events],
          running: temp.endedAt === null ? [temp, ...prev.running] : prev.running,
        });
      }
      return { prev };
    },
    onError: (err, _input, ctxData) => {
      if (ctxData?.prev) qc.setQueryData(RECENT_KEY, ctxData.prev);
      if (onApiError) onApiError(err);
      else toast(err instanceof Error ? err.message : "error");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number } & Record<string, unknown>) =>
      api.patch<{ event: ApiEvent }>(`/api/events/${id}`, patch),
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: RECENT_KEY });
      const prev = qc.getQueryData<RecentData>(RECENT_KEY);
      if (prev) {
        const apply = (e: ApiEvent) => (e.id === id ? ({ ...e, ...patch } as ApiEvent) : e);
        const updatedEvents = prev.events.map(apply);
        const updatedRunning = prev.running.map(apply);
        const runningById = new Map<number, ApiEvent>();
        for (const e of [...updatedRunning, ...updatedEvents]) {
          if (e.endedAt === null) runningById.set(e.id, e);
        }
        qc.setQueryData<RecentData>(RECENT_KEY, {
          events: updatedEvents,
          running: [...runningById.values()],
        });
      }
      return { prev };
    },
    onError: (err, _v, ctxData) => {
      if (ctxData?.prev) qc.setQueryData(RECENT_KEY, ctxData.prev);
      toast(err instanceof Error ? err.message : "error");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/api/events/${id}`),
    onError: (err) => toast(err instanceof Error ? err.message : "error"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
