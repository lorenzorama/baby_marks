"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/** iOS Safari has no Element.requestFullscreen; video elements there expose
 *  the older WebKit entry point instead. */
type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/** What a watching device shows. Starts muted because browsers refuse
 *  autoplay with sound; a tap on "enable sound" unmutes. */
export default function ViewerStage({
  stream,
  onSnapshot,
}: {
  stream: MediaStream;
  onSnapshot?: (video: HTMLVideoElement) => void;
}) {
  const t = useTranslations("camera");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  const enableSound = () => {
    setMuted(false);
    // Some browsers pause a muted autoplay when it gains audio; we are inside
    // the user gesture that makes resuming legal.
    void videoRef.current?.play().catch(() => {});
  };

  const goFullscreen = () => {
    const video = videoRef.current as FullscreenVideo | null;
    if (!video) return;
    if (typeof video.requestFullscreen === "function") {
      void video.requestFullscreen().catch(() => {});
    } else {
      video.webkitEnterFullscreen?.();
    }
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-3xl bg-black">
        <video ref={videoRef} autoPlay playsInline muted={muted} className="w-full" />
      </div>
      <div className="flex flex-wrap gap-3">
        {muted && (
          <button
            onClick={enableSound}
            className="min-h-[52px] flex-1 rounded-2xl bg-primary px-4 text-base font-semibold text-white"
          >
            {t("enableSound")}
          </button>
        )}
        <button
          onClick={goFullscreen}
          className="min-h-[52px] flex-1 rounded-2xl bg-surface-2 px-4 text-base font-semibold text-ink"
        >
          {t("fullscreen")}
        </button>
        {onSnapshot && (
          <button
            onClick={() => videoRef.current && onSnapshot(videoRef.current)}
            className="min-h-[52px] flex-1 rounded-2xl bg-surface-2 px-4 text-base font-semibold text-ink"
          >
            📸 {t("snapshot")}
          </button>
        )}
      </div>
    </div>
  );
}
