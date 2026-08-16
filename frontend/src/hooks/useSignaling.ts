"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Signaling,
  rtcUrl,
  type ClientMessage,
  type ServerMessage,
  type SignalingState,
} from "@/lib/rtc/signaling";

const PING_MS = 25_000;

/** One signaling connection for the page, with a 25 s app-level heartbeat
 *  (proxies drop idle websockets long before that matters). */
export function useSignaling(onMessage: (msg: ServerMessage) => void) {
  const [state, setState] = useState<SignalingState>("closed");
  const [peerId, setPeerId] = useState<string | null>(null);
  const clientRef = useRef<Signaling | null>(null);
  const handlerRef = useRef(onMessage);

  // Keep the latest handler without re-opening the socket. Declared before the
  // connect effect so it is refreshed first on every commit.
  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const client = new Signaling({
      url: rtcUrl(window.location.origin, process.env.NEXT_PUBLIC_RTC_URL),
      onState: setState,
      onMessage: (msg) => {
        if (msg.type === "welcome") setPeerId(msg.peerId);
        handlerRef.current(msg);
      },
    });
    clientRef.current = client;
    client.connect();
    const ping = setInterval(() => client.send({ type: "ping" }), PING_MS);
    return () => {
      clearInterval(ping);
      client.close();
      clientRef.current = null;
    };
  }, []);

  const send = useCallback((msg: ClientMessage) => clientRef.current?.send(msg), []);
  return { send, state, peerId };
}
