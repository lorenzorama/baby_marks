"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { applySignal, createPeer } from "@/lib/rtc/peer";
import type { ClientMessage, ServerMessage } from "@/lib/rtc/signaling";

export type ViewerStatus = "idle" | "connecting" | "live" | "lost";

type Send = (msg: ClientMessage) => void;

/** Viewer side: one peer connection to the current camera. The camera is the
 *  offerer, so this side only answers and consumes the incoming tracks. */
export function useViewerRole(send: Send) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<ViewerStatus>("idle");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const cameraIdRef = useRef<string | null>(null);

  const teardown = useCallback(() => {
    // Tell the hub this peer stopped watching whenever a watch was actually
    // in flight — takeover (camera_changed), the too-many-viewers/no-camera
    // errors, and leave() all end a session and must free the viewer slot.
    // watch() itself calls teardown() first when re-watching (e.g. retry, or
    // a new camera appearing mid-connect): that "stop" is sent synchronously
    // before watch() later sends its own "watch" on the same socket, so
    // ordering is preserved and the hub's `stop` handler is a no-op for a
    // peer already removed from `_watchers` — the re-watch path stays safe.
    if (cameraIdRef.current !== null) send({ type: "stop" });
    pcRef.current?.close();
    pcRef.current = null;
    cameraIdRef.current = null;
    setStream(null);
  }, [send]);

  const watch = useCallback(
    (cameraId: string) => {
      teardown();
      cameraIdRef.current = cameraId;
      setStatus("connecting");
      const pc = createPeer(
        (data) => send({ type: "signal", to: cameraId, data }),
        (incoming) => {
          setStream(incoming);
          setStatus("live");
        },
      );
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setStatus("lost");
        }
      };
      pcRef.current = pc;
      send({ type: "watch" });
    },
    [send, teardown],
  );

  const leave = useCallback(() => {
    // teardown() already sends "stop" when a camera is being watched.
    teardown();
    setStatus("idle");
  }, [teardown]);

  const handleMessage = useCallback(
    async (msg: ServerMessage) => {
      // Every message reaches both roles, so each branch checks that it is
      // really addressed to a viewer session this device opened.
      if (msg.type === "signal") {
        if (pcRef.current && msg.from === cameraIdRef.current) {
          await applySignal(pcRef.current, msg.data, (data) =>
            send({ type: "signal", to: msg.from, data }),
          );
        }
      } else if (msg.type === "camera_changed") {
        // The camera went away or was taken over by another device: the old
        // peer connection is dead either way, so drop back to the idle screen.
        if (cameraIdRef.current !== null && msg.camera?.id !== cameraIdRef.current) {
          teardown();
          setStatus("idle");
        }
      } else if (msg.type === "error" && cameraIdRef.current !== null) {
        if (msg.code === "too_many_viewers" || msg.code === "no_camera") {
          teardown();
          setStatus("lost");
        }
      }
    },
    [send, teardown],
  );

  // Close the peer connection if the page goes away mid-watch.
  useEffect(() => {
    const pc = pcRef;
    return () => {
      pc.current?.close();
      pc.current = null;
    };
  }, []);

  return { watch, leave, handleMessage, stream, status };
}
