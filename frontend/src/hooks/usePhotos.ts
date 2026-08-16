"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { toast } from "@/components/Toast";
import type { Photo } from "@/lib/types";

export function usePhotos() {
  return useQuery<Photo[]>({
    queryKey: ["photos"],
    queryFn: async () => (await api.get<{ photos: Photo[] }>("/api/photos")).photos,
  });
}

export function useUploadPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (blob: Blob) => {
      const res = await fetch("/api/photos", {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { photo: Photo };
    },
    onError: (err) => toast(err instanceof Error ? err.message : "error"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["photos"] }),
  });
}

export function useDeletePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/photos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
    },
    onError: (err) => toast(err instanceof Error ? err.message : "error"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["photos"] }),
  });
}
