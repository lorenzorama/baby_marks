"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api-client";
import { toast } from "@/components/Toast";
import type { Photo } from "@/lib/types";

export function usePhotos() {
  return useQuery<Photo[]>({
    queryKey: ["photos"],
    queryFn: async () => (await api.get<{ photos: Photo[] }>("/api/photos")).photos,
  });
}

// Mirrors the error handling in api-client.ts's request(): parse the JSON
// error body and fall back to the response's status text. Needed here
// (rather than reusing api.post/api.delete) because the upload body is a
// raw JPEG blob, not JSON.
async function throwApiError(res: Response): Promise<never> {
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  const msg = (data as { error?: string })?.error ?? res.statusText;
  throw new ApiError(res.status, msg, data);
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
      if (!res.ok) await throwApiError(res);
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
      if (!res.ok) await throwApiError(res);
    },
    onError: (err) => toast(err instanceof Error ? err.message : "error"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["photos"] }),
  });
}
