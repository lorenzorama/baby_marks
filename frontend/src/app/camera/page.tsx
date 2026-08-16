"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import CameraStage from "@/components/CameraStage";
import { useCameraRole } from "@/hooks/useCameraRole";
import { useSignaling } from "@/hooks/useSignaling";
import type { CameraInfo, ServerMessage } from "@/lib/rtc/signaling";

const NAME_KEY = "bm_device_name";

export default function CameraPage() {
  const t = useTranslations("camera");
  const [camera, setCamera] = useState<CameraInfo | null>(null);
  const [name, setName] = useState("");
  const [busyName, setBusyName] = useState<string | null>(null);
  const cameraRoleRef = useRef<((msg: ServerMessage) => void) | null>(null);

  const onMessage = useCallback(
    (msg: ServerMessage) => {
      if (msg.type === "welcome" || msg.type === "camera_changed") setCamera(msg.camera);
      if (msg.type === "error" && msg.code === "camera_busy") setBusyName(camera?.name ?? "");
      cameraRoleRef.current?.(msg);
    },
    [camera],
  );

  const { send, peerId } = useSignaling(onMessage);
  const role = useCameraRole(send);
  const handleRoleMessage = role.handleMessage;

  // The ref breaks the cycle onMessage -> role -> send -> onMessage; it is
  // refreshed after commit, long before the socket can deliver anything.
  useEffect(() => {
    cameraRoleRef.current = (msg) => void handleRoleMessage(msg);
  }, [handleRoleMessage]);

  const deviceName = () => {
    if (name) return name;
    const stored = typeof window !== "undefined" ? localStorage.getItem(NAME_KEY) : null;
    return stored || t("defaultName");
  };

  const startCamera = async (mode: "hello" | "takeover" = "hello") => {
    const chosen = deviceName();
    localStorage.setItem(NAME_KEY, chosen);
    setBusyName(null);
    await role.start(chosen, mode);
  };

  const isThisDeviceTheCamera = camera !== null && camera.id === peerId;

  if (role.stream && isThisDeviceTheCamera) {
    return (
      <main className="mx-auto max-w-2xl p-5 pb-24">
        <CameraStage
          stream={role.stream}
          viewerCount={role.viewerCount}
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
        {role.error && <p className="text-sm text-danger">{t("permissionDenied")}</p>}
        {busyName !== null && (
          <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
            <p className="text-sm text-ink">{t("takeoverPrompt", { name: busyName })}</p>
            <button
              onClick={() => void startCamera("takeover")}
              className="min-h-[44px] w-full rounded-2xl bg-primary px-4 text-sm font-semibold text-white"
            >
              {t("takeoverConfirm")}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
