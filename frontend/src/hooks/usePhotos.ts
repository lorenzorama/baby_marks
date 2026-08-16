"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { toast } from "@/components/Toast";
import type { Photo } from "@/lib/types";

// The backend keeps the 200 most recent photos and defaults this endpoint to
// 50, so without an explicit limit the gallery could never show — nor let you
// delete — photos 51 to 200, which stay in the DB and in every backup.
const LIMIT = 200;

export function usePhotos() {
  return useQuery<Photo[]>({
    queryKey: ["photos"],
    queryFn: async () =>
      (await api.get<{ photos: Photo[] }>(`/api/photos?limit=${LIMIT}`)).photos,
  });
}

export function useUploadPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (blob: Blob) => api.postRaw<{ photo: Photo }>("/api/photos", blob, "image/jpeg"),
    onError: (err) => toast(err instanceof Error ? err.message : "error"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["photos"] }),
  });
}

export function useDeletePhoto() {
  const qc = useQueryClient();
  return useMutation({
    // The endpoint answers 204 with no body; request() handles that.
    mutationFn: (id: number) => api.delete<void>(`/api/photos/${id}`),
    onError: (err) => toast(err instanceof Error ? err.message : "error"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["photos"] }),
  });
}
