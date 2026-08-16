"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

const DIM_AFTER_MS = 10_000;

/** What the filming device shows: a live preview that fades to a black
 *  screen with a single red dot, so the phone lights nothing in the room. */
export default function CameraStage({
  stream,
  viewerCount,
  flipping,
  onFlip,
  onStop,
}: {
  stream: MediaStream;
  viewerCount: number;
  /** True while a camera switch is in flight; a second tap during that window
   *  would open a camera track the hook can no longer stop. */
  flipping: boolean;
  onFlip: () => void;
  onStop: () => void;
}) {
  const t = useTranslations("camera");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [dimmed, setDimmed] = useState(false);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (dimmed) return;
    const timer = setTimeout(() => setDimmed(true), DIM_AFTER_MS);
    return () => clearTimeout(timer);
  }, [dimmed]);

  if (dimmed) {
    return (
      <button
        onClick={() => setDimmed(false)}
        className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black text-white/40"
      >
        <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
        <span className="text-sm">{t("tapToShow")}</span>
      </button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-3xl bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="w-full" />
      </div>
      <p className="text-sm text-ink-soft">{t("keepForeground")}</p>
      {typeof navigator !== "undefined" && !("wakeLock" in navigator) && (
        <p className="text-sm text-danger">{t("wakeLockUnsupported")}</p>
      )}
      <p className="text-sm font-semibold text-ink">
        {t("streaming")} · {t("viewers", { count: viewerCount })}
      </p>
      <div className="flex gap-3">
        <button
          onClick={onFlip}
          disabled={flipping}
          className="min-h-[52px] flex-1 rounded-2xl bg-surface-2 px-4 text-base font-semibold text-ink disabled:opacity-50"
        >
          {t("switchCamera")}
        </button>
        <button
          onClick={onStop}
          className="min-h-[52px] flex-1 rounded-2xl bg-danger px-4 text-base font-semibold text-white"
        >
          {t("stop")}
        </button>
      </div>
    </div>
  );
}
