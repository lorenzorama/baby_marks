import { describe, expect, it, vi } from "vitest";
import { Signaling, rtcUrl, type ServerMessage } from "@/lib/rtc/signaling";

class FakeSocket {
  static instances: FakeSocket[] = [];
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
  open() {
    this.onopen?.();
  }
  emit(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function setup() {
  FakeSocket.instances = [];
  const received: ServerMessage[] = [];
  const states: string[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const signaling = new Signaling({
    url: "ws://test/rtc",
    onMessage: (m) => received.push(m),
    onState: (s) => states.push(s),
    createSocket: (url) => new FakeSocket(url),
    schedule: (fn, ms) => {
      timers.push({ fn, ms });
    },
  });
  return { signaling, received, states, timers, socket: () => FakeSocket.instances.at(-1)! };
}

describe("rtcUrl", () => {
  it("derives a wss url from an https origin", () => {
    expect(rtcUrl("https://baby.canastrat.com")).toBe("wss://baby.canastrat.com/rtc");
  });
  it("derives a ws url from an http origin", () => {
    expect(rtcUrl("http://localhost:3000")).toBe("ws://localhost:3000/rtc");
  });
  it("prefers an explicit override", () => {
    expect(rtcUrl("https://x.test", "ws://localhost:8000/rtc")).toBe("ws://localhost:8000/rtc");
  });
});

describe("Signaling", () => {
  it("reports state transitions and delivers parsed messages", () => {
    const { signaling, received, states, socket } = setup();
    signaling.connect();
    expect(states).toEqual(["connecting"]);
    socket().open();
    expect(states).toEqual(["connecting", "open"]);
    socket().emit({ type: "welcome", peerId: "p1", camera: null });
    expect(received).toEqual([{ type: "welcome", peerId: "p1", camera: null }]);
  });

  it("queues sends made before the socket opens, then flushes them in order", () => {
    const { signaling, socket } = setup();
    signaling.connect();
    signaling.send({ type: "hello", role: "camera", name: "Chambre" });
    signaling.send({ type: "watch" });
    expect(socket().sent).toEqual([]);
    socket().open();
    expect(socket().sent.map((s) => JSON.parse(s).type)).toEqual(["hello", "watch"]);
  });

  it("ignores malformed frames instead of throwing", () => {
    const { signaling, received, socket } = setup();
    signaling.connect();
    socket().open();
    socket().onmessage?.({ data: "not json" });
    expect(received).toEqual([]);
  });

  it("reconnects with a capped exponential backoff", () => {
    const { signaling, timers, socket } = setup();
    signaling.connect();
    socket().open();
    for (const expected of [1000, 2000, 4000, 8000, 15000, 15000]) {
      socket().close();
      expect(timers.at(-1)!.ms).toBe(expected);
      timers.at(-1)!.fn();
      socket().open();
    }
  });

  it("resets the backoff after a successful connection", () => {
    const { signaling, timers, socket } = setup();
    signaling.connect();
    socket().open();
    socket().close();
    expect(timers.at(-1)!.ms).toBe(1000);
    timers.at(-1)!.fn();
    socket().open();
    socket().close();
    expect(timers.at(-1)!.ms).toBe(1000);
  });

  it("stops reconnecting once closed on purpose", () => {
    const { signaling, timers, states, socket } = setup();
    signaling.connect();
    socket().open();
    signaling.close();
    expect(socket().closed).toBe(true);
    expect(timers).toEqual([]);
    expect(states.at(-1)).toBe("closed");
  });

  it("sends a heartbeat ping on demand", () => {
    const { signaling, socket } = setup();
    signaling.connect();
    socket().open();
    signaling.send({ type: "ping" });
    expect(JSON.parse(socket().sent.at(-1)!)).toEqual({ type: "ping" });
  });
});
