"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import CameraStage from "@/components/CameraStage";
import PhotoGallery from "@/components/PhotoGallery";
import { toast } from "@/components/Toast";
import ViewerStage from "@/components/ViewerStage";
import { useCameraRole } from "@/hooks/useCameraRole";
import { useUploadPhoto } from "@/hooks/usePhotos";
import { useSignaling } from "@/hooks/useSignaling";
import { useViewerRole } from "@/hooks/useViewerRole";
import type { CameraInfo, ServerMessage } from "@/lib/rtc/signaling";
import { captureFrame } from "@/lib/snapshot";

const NAME_KEY = "bm_device_name";

export default function CameraPage() {
  const t = useTranslations("camera");
  const tSheets = useTranslations("sheets");
  const [camera, setCamera] = useState<CameraInfo | null>(null);
  const [name, setName] = useState("");
  // `null` = no prompt. `{ name: null }` = prompt without a name to show,
  // which happens when camera_busy arrives before we ever learned who holds
  // the camera (e.g. racing another device on a fresh connection).
  const [takeover, setTakeover] = useState<{ name: string | null } | null>(null);
  const rolesRef = useRef<((msg: ServerMessage) => void) | null>(null);
  // Mirrors `camera` for the message handler. Reading the state variable there
  // would read whatever was captured when the handler was created, which is
  // one message behind — camera_busy always follows the welcome/camera_changed
  // that names the current camera. Written from an event callback, never
  // during render.
  const cameraRef = useRef<CameraInfo | null>(null);

  const onMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === "welcome" || msg.type === "camera_changed") {
      cameraRef.current = msg.camera;
      setCamera(msg.camera);
    }
    if (msg.type === "error" && msg.code === "camera_busy") {
      setTakeover({ name: cameraRef.current?.name ?? null });
    }
    rolesRef.current?.(msg);
  }, []);

  const { send, peerId, peerIdRef } = useSignaling(onMessage);
  const role = useCameraRole(send, peerIdRef);
  const viewer = useViewerRole(send);
  const upload = useUploadPhoto();
  const handleRoleMessage = role.handleMessage;
  const handleViewerMessage = viewer.handleMessage;

  // The ref breaks the cycle onMessage -> role -> send -> onMessage; it is
  // refreshed after commit, long before the socket can deliver anything.
  // Both roles see every message and each ignores what is not its business.
  useEffect(() => {
    rolesRef.current = (msg) => {
      // Both handlers can reject on a malformed remote payload (a bad `sdp`
      // makes setRemoteDescription throw). Swallow it: an unusable signaling
      // frame is not worth an unhandled rejection, and the connection state
      // change already drives the UI back to a retryable state.
      void handleRoleMessage(msg).catch(() => {});
      void handleViewerMessage(msg).catch(() => {});
    };
  }, [handleRoleMessage, handleViewerMessage]);

  const deviceName = () => {
    if (name) return name;
    const stored = typeof window !== "undefined" ? localStorage.getItem(NAME_KEY) : null;
    return stored || t("defaultName");
  };

  const startCamera = async (mode: "hello" | "takeover" = "hello") => {
    const chosen = deviceName();
    localStorage.setItem(NAME_KEY, chosen);
    setTakeover(null);
    await role.start(chosen, mode);
  };

  // Declining the takeover: the media and the wake lock were already acquired
  // when the server answered camera_busy, so give them back.
  const cancelTakeover = () => {
    setTakeover(null);
    role.release();
  };

  // captureFrame rejects when canvas.toBlob yields null (e.g. a 0x0 canvas,
  // reachable the instant the stream attaches, before videoWidth/videoHeight
  // are populated). Surface that with a toast instead of an unhandled
  // rejection; upload failures are already toasted by useUploadPhoto.
  const takeSnapshot = (video: HTMLVideoElement) => {
    void captureFrame(video)
      .then((blob) => upload.mutate(blob))
      .catch(() => toast(t("snapshotFailed")));
  };

  const isThisDeviceTheCamera = camera !== null && camera.id === peerId;

  if (role.stream && isThisDeviceTheCamera) {
    return (
      <main className="mx-auto max-w-2xl p-5 pb-24">
        <CameraStage
          stream={role.stream}
          viewerCount={role.viewerCount}
          flipping={role.flipping}
          onFlip={() => void role.flip()}
          onStop={role.stop}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-5 pb-24">
      <h1 className="text-2xl font-bold text-ink">{t("title")}</h1>

      <section className="space-y-3 rounded-3xl bg-surface p-4 shadow-sm">
        <label className="block text-sm font-semibold text-ink" htmlFor="device-name">
          {t("deviceName")}
        </label>
        <input
          id="device-name"
          value={name}
          placeholder={t("defaultName")}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          className="min-h-[52px] w-full rounded-2xl bg-surface-2 px-4 text-base text-ink"
        />
        <button
          onClick={() => void startCamera()}
          className="min-h-[52px] w-full rounded-2xl bg-primary px-4 text-base font-semibold text-white"
        >
          {t("useThisDevice")}
        </button>
        {role.error && (
          <p className="text-sm text-danger">
            {role.error === "permissionDenied" ? t("permissionDenied") : t("cameraUnavailable")}
          </p>
        )}
        {takeover !== null && (
          <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
            <p className="text-sm text-ink">
              {takeover.name
                ? t("takeoverPrompt", { name: takeover.name })
                : t("takeoverPromptUnknown")}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => void startCamera("takeover")}
                className="min-h-[44px] flex-1 rounded-2xl bg-primary px-4 text-sm font-semibold text-white"
              >
                {t("takeoverConfirm")}
              </button>
              <button
                onClick={cancelTakeover}
                className="min-h-[44px] flex-1 rounded-2xl bg-surface px-4 text-sm font-semibold text-ink"
              >
                {tSheets("cancel")}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-3xl bg-surface p-4 shadow-sm">
        {camera === null || isThisDeviceTheCamera ? (
          <>
            <p className="text-base font-semibold text-ink">{t("noCamera")}</p>
            <p className="text-sm text-ink-soft">{t("noCameraHint")}</p>
          </>
        ) : viewer.stream ? (
          <ViewerStage
            stream={viewer.stream}
            onSnapshot={takeSnapshot}
            busy={upload.isPending}
          />
        ) : (
          <>
            <p className="text-base font-semibold text-ink">📹 {camera.name}</p>
            {viewer.status === "lost" && (
              <p className="text-sm text-danger">
                {viewer.reason === "too_many_viewers" ? t("tooManyViewers") : t("lost")}
              </p>
            )}
            {/* Retry is offered even for "too many viewers": another viewer
                may leave and free a slot at any time, and this device gets
                no notification when that happens, so a manual retry is the
                only way back in short of reloading the page. */}
            <button
              onClick={() => viewer.watch(camera.id)}
              className="min-h-[52px] w-full rounded-2xl bg-primary px-4 text-base font-semibold text-white"
            >
              {viewer.status === "connecting"
                ? t("connecting")
                : viewer.status === "lost"
                  ? t("retry")
                  : t("watch")}
            </button>
          </>
        )}
      </section>

      <PhotoGallery />
    </main>
  );
}
