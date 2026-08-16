"use client";

import { useTranslations } from "next-intl";
import { useDeletePhoto, usePhotos } from "@/hooks/usePhotos";

export default function PhotoGallery() {
  const t = useTranslations("camera");
  const { data: photos = [] } = usePhotos();
  const remove = useDeletePhoto();

  return (
    <section className="space-y-3 rounded-3xl bg-surface p-4 shadow-sm">
      <h2 className="text-base font-semibold text-ink">{t("gallery")}</h2>
      {photos.length === 0 ? (
        <p className="text-sm text-ink-soft">{t("galleryEmpty")}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <li key={photo.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- authenticated
                  bytes served by our own API; next/image would need a loader. */}
              <img
                src={`/api/photos/${photo.id}`}
                alt=""
                loading="lazy"
                decoding="async"
                className="aspect-square w-full rounded-2xl object-cover"
              />
              <button
                onClick={() => {
                  if (confirm(t("confirmDeletePhoto"))) remove.mutate(photo.id);
                }}
                aria-label={t("confirmDeletePhoto")}
                className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-sm text-white"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
