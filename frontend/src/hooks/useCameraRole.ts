"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPeer, applySignal, offerTo } from "@/lib/rtc/peer";
import type { ClientMessage, ServerMessage } from "@/lib/rtc/signaling";

type Send = (msg: ClientMessage) => void;

/** getUserMedia rejects for very different reasons: a refused permission is the
 *  user's to fix, but "no such camera" or "device already in use" is not. */
function mediaErrorCode(err: unknown): string {
  const name =
    typeof err === "object" && err !== null && "name" in err
      ? String((err as { name: unknown }).name)
      : "";
  return name === "NotAllowedError" || name === "SecurityError"
    ? "permissionDenied"
    : "cameraUnavailable";
}

/** Camera side: owns the media stream, the wake lock, and one peer
 *  connection per viewer (the camera is always the offerer).
 *  `peerId` is this device's own signaling id, used to tell "the camera
 *  changed to someone else" from "the camera changed to me". */
export function useCameraRole(send: Send, peerId: string | null) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [error, setError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const streamRef = useRef<MediaStream | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) return false;
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      return true;
    } catch {
      return false;
    }
  }, []);

  /** Drop every local resource (tracks, peers, wake lock) without telling the
   *  server anything. Shared by stop(), start() and the takeover paths. */
  const release = useCallback(() => {
    for (const pc of peersRef.current.values()) pc.close();
    peersRef.current.clear();
    setViewerCount(0);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    releaseWakeLock();
  }, [releaseWakeLock]);

  const start = useCallback(
    async (name: string, mode: "hello" | "takeover" = "hello") => {
      setError(null);
      // A previous attempt may still hold a stream (typically the one the
      // server refused with camera_busy); never stack two of them.
      release();
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio: true,
        });
        streamRef.current = media;
        setStream(media);
        await acquireWakeLock();
        send({ type: mode, role: "camera", name } as ClientMessage);
      } catch (err) {
        setError(mediaErrorCode(err));
      }
    },
    [acquireWakeLock, facingMode, release, send],
  );

  const stop = useCallback(() => {
    send({ type: "stop" });
    release();
  }, [release, send]);

  const flip = useCallback(async () => {
    const next = facingMode === "environment" ? "user" : "environment";
    const current = streamRef.current;
    if (!current) {
      setFacingMode(next);
      return;
    }
    // Video only: re-requesting audio would open a second microphone track and
    // leave late viewers on a different audio track than the early ones.
    const media = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: next },
      audio: false,
    });
    const videoTrack = media.getVideoTracks()[0];
    if (!videoTrack) {
      media.getTracks().forEach((track) => track.stop());
      return;
    }
    for (const pc of peersRef.current.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      await sender?.replaceTrack(videoTrack);
    }
    // Keep the very same audio track across the flip, so every viewer — old
    // and new — stays on one microphone.
    const composed = new MediaStream([videoTrack, ...current.getAudioTracks()]);
    current.getVideoTracks().forEach((track) => track.stop());
    streamRef.current = composed;
    setStream(composed);
    setFacingMode(next);
  }, [facingMode]);

  /** Feed every signaling message concerning this camera. */
  const handleMessage = useCallback(
    async (msg: ServerMessage) => {
      if (!streamRef.current) return;
      if (msg.type === "camera_changed") {
        // Another device took over (or the server cleared the camera): this
        // device is no longer filming for anyone. Release locally only — the
        // server has already moved on, and a late `stop` would clear the new
        // camera instead of this one.
        if (msg.camera?.id !== peerId) release();
        return;
      }
      if (msg.type === "viewer_joined") {
        const pc = createPeer((data) => send({ type: "signal", to: msg.peerId, data }));
        for (const track of streamRef.current.getTracks()) {
          pc.addTrack(track, streamRef.current);
        }
        peersRef.current.set(msg.peerId, pc);
        setViewerCount(peersRef.current.size);
        await offerTo(pc, (data) => send({ type: "signal", to: msg.peerId, data }));
      } else if (msg.type === "viewer_left") {
        peersRef.current.get(msg.peerId)?.close();
        peersRef.current.delete(msg.peerId);
        setViewerCount(peersRef.current.size);
      } else if (msg.type === "signal") {
        const pc = peersRef.current.get(msg.from);
        if (pc) {
          await applySignal(pc, msg.data, (data) =>
            send({ type: "signal", to: msg.from, data }),
          );
        }
      }
    },
    [peerId, release, send],
  );

  // Re-acquire the wake lock when the app comes back to the foreground.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && streamRef.current) {
        void acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [acquireWakeLock]);

  useEffect(() => {
    const peers = peersRef.current;
    return () => {
      for (const pc of peers.values()) pc.close();
      peers.clear();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      releaseWakeLock();
    };
  }, [releaseWakeLock]);

  return { start, stop, release, flip, handleMessage, stream, error, facingMode, viewerCount };
}
