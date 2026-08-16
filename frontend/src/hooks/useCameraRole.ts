"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPeer, applySignal, offerTo } from "@/lib/rtc/peer";
import type { ClientMessage, ServerMessage } from "@/lib/rtc/signaling";

type Send = (msg: ClientMessage) => void;

/** Camera side: owns the media stream, the wake lock, and one peer
 *  connection per viewer (the camera is always the offerer). */
export function useCameraRole(send: Send) {
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

  const start = useCallback(
    async (name: string, mode: "hello" | "takeover" = "hello") => {
      setError(null);
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio: true,
        });
        streamRef.current = media;
        setStream(media);
        await acquireWakeLock();
        send({ type: mode, role: "camera", name } as ClientMessage);
      } catch {
        setError("permissionDenied");
      }
    },
    [acquireWakeLock, facingMode, send],
  );

  const stop = useCallback(() => {
    send({ type: "stop" });
    for (const pc of peersRef.current.values()) pc.close();
    peersRef.current.clear();
    setViewerCount(0);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    releaseWakeLock();
  }, [releaseWakeLock, send]);

  const flip = useCallback(async () => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    if (!streamRef.current) return;
    const media = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: next },
      audio: true,
    });
    const videoTrack = media.getVideoTracks()[0];
    for (const pc of peersRef.current.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      await sender?.replaceTrack(videoTrack);
    }
    streamRef.current.getVideoTracks().forEach((track) => track.stop());
    streamRef.current = media;
    setStream(media);
  }, [facingMode]);

  /** Feed every signaling message concerning this camera. */
  const handleMessage = useCallback(
    async (msg: ServerMessage) => {
      if (!streamRef.current) return;
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
    [send],
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

  return { start, stop, flip, handleMessage, stream, error, facingMode, viewerCount };
}
