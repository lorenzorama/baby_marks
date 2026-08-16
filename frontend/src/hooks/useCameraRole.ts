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
  const [flipping, setFlipping] = useState(false);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const streamRef = useRef<MediaStream | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  /** The name this device is currently filming under, kept so the session can
   *  re-announce itself after the backend restarts (see handleMessage). */
  const streamingNameRef = useRef<string | null>(null);
  /** Set for the whole duration of a flip. `flipping` state drives the UI, but
   *  state is not readable synchronously, so a second tap in the same tick
   *  would slip past it — the ref is the actual guard. */
  const flippingRef = useRef(false);

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
    streamingNameRef.current = null;
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
        streamingNameRef.current = name;
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
    // Without this guard two quick taps both capture the same starting stream;
    // the loser's freshly opened video track never reaches `streamRef`, so
    // release()/stop() cannot find it and the phone keeps filming until the
    // tab closes.
    if (flippingRef.current) return;
    const next = facingMode === "environment" ? "user" : "environment";
    const current = streamRef.current;
    if (!current) {
      setFacingMode(next);
      return;
    }
    flippingRef.current = true;
    setFlipping(true);
    try {
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
      // Anything awaited above can have been outlived by a stop() or a
      // takeover, which already released `current`. Publishing now would
      // re-attach a live track to a stream nobody owns, so hand back what was
      // just acquired instead.
      if (streamRef.current !== current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      for (const pc of peersRef.current.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        await sender?.replaceTrack(videoTrack);
      }
      if (streamRef.current !== current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      // Keep the very same audio track across the flip, so every viewer — old
      // and new — stays on one microphone.
      const composed = new MediaStream([videoTrack, ...current.getAudioTracks()]);
      current.getVideoTracks().forEach((track) => track.stop());
      streamRef.current = composed;
      setStream(composed);
      setFacingMode(next);
    } catch {
      // A refused or failed getUserMedia leaves the current stream untouched;
      // the monitor keeps filming on the side it was already using, which is
      // better than an unhandled rejection from the caller's `void flip()`.
    } finally {
      flippingRef.current = false;
      setFlipping(false);
    }
  }, [facingMode]);

  /** Feed every signaling message concerning this camera. */
  const handleMessage = useCallback(
    async (msg: ServerMessage) => {
      if (!streamRef.current) return;
      if (msg.type === "welcome") {
        // A `welcome` while this device is still filming means the socket was
        // re-established (the backend restarts on every deploy): the hub state
        // is gone and this peer has a brand-new id, so without re-announcing,
        // the camera would keep the lens, the microphone and the wake lock
        // while the page falls back to the setup form and nobody can watch.
        // A `camera_busy` answer (another device claimed the hub meanwhile)
        // reaches the page's error handler and opens the takeover prompt.
        // Every existing peer connection is addressed to a peer id that no
        // longer exists, and the hub dropped its watchers, so viewers will
        // come back as new ids: close the old ones instead of leaking an ICE
        // agent each and reporting phantom viewers forever.
        for (const pc of peersRef.current.values()) pc.close();
        peersRef.current.clear();
        setViewerCount(0);
        const name = streamingNameRef.current;
        if (name !== null) send({ type: "hello", role: "camera", name });
        return;
      }
      if (msg.type === "camera_changed") {
        // Another device took over (or the server cleared the camera): this
        // device is no longer filming for anyone. Release locally only — the
        // server has already moved on, and a late `stop` would clear the new
        // camera instead of this one.
        if (msg.camera?.id !== peerId) release();
        return;
      }
      if (msg.type === "viewer_joined") {
        // The hub now ignores a repeated `watch`, but a viewer that legitimately
        // re-watches (retry, or after a takeover) does produce a second
        // viewer_joined for the same peer id. Overwriting the map entry would
        // strand the old RTCPeerConnection — still holding an ICE agent and a
        // sender for our tracks — with no way to ever close it.
        peersRef.current.get(msg.peerId)?.close();
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

  return {
    start,
    stop,
    release,
    flip,
    flipping,
    handleMessage,
    stream,
    error,
    facingMode,
    viewerCount,
  };
}
