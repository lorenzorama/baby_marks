export type CameraInfo = { id: string; name: string; since: number };

export type ServerMessage =
  | { type: "welcome"; peerId: string; camera: CameraInfo | null }
  | { type: "camera_changed"; camera: CameraInfo | null }
  | { type: "viewer_joined"; peerId: string }
  | { type: "viewer_left"; peerId: string }
  | { type: "signal"; from: string; data: unknown }
  | { type: "error"; code: string }
  | { type: "pong" };

export type ClientMessage =
  | { type: "hello"; role: "camera" | "viewer"; name?: string }
  | { type: "watch" }
  | { type: "signal"; to: string; data: unknown }
  | { type: "takeover"; name?: string }
  | { type: "stop" }
  | { type: "ping" };

export type SignalingState = "connecting" | "open" | "closed";

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface SignalingOptions {
  url: string;
  onMessage: (msg: ServerMessage) => void;
  onState?: (state: SignalingState) => void;
  /** Injectable for tests; defaults to a real WebSocket. */
  createSocket?: (url: string) => SocketLike;
  /** Injectable for tests; defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => void;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

/** Cap on the offline send queue. Signaling frames are only useful to the peer
 *  connection that was being negotiated when the socket died, and no peer
 *  connection survives an outage long enough to fill this queue — so once it is
 *  full the OLDEST frames are the safe ones to drop. */
const MAX_QUEUE = 64;

/** Derive the signaling URL from the page origin, unless overridden. */
export function rtcUrl(origin: string, override?: string): string {
  if (override) return override;
  return origin.replace(/^http/, "ws") + "/rtc";
}

export class Signaling {
  state: SignalingState = "closed";
  private socket: SocketLike | null = null;
  private queue: ClientMessage[] = [];
  private attempt = 0;
  private stopped = false;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly schedule: (fn: () => void, ms: number) => void;

  constructor(private readonly opts: SignalingOptions) {
    this.createSocket =
      opts.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  }

  private setState(state: SignalingState) {
    this.state = state;
    this.opts.onState?.(state);
  }

  connect() {
    // Reentrancy guard: a second connect() would orphan the live socket, which
    // would then fight the new one from its own (late) callbacks.
    if (this.socket && !this.stopped) return;
    this.stopped = false;
    this.setState("connecting");
    const socket = this.createSocket(this.opts.url);
    this.socket = socket;
    // Every callback below ignores its event once `socket` is no longer the
    // current one: a dead socket must never touch the state of a live one.
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.setState("open");
      const pending = this.queue;
      this.queue = [];
      for (const msg of pending) socket.send(JSON.stringify(msg));
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return; // a frame we cannot read is not worth crashing the monitor over
      }
      if (parsed && typeof parsed === "object" && "type" in parsed) {
        this.opts.onMessage(parsed as ServerMessage);
      }
    };
    socket.onerror = () => {
      /* onclose always follows; reconnection is handled there */
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.stopped) return;
      const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
      this.attempt += 1;
      this.setState("connecting");
      this.schedule(() => {
        if (!this.stopped) this.connect();
      }, delay);
    };
  }

  send(msg: ClientMessage) {
    if (this.socket && this.state === "open") {
      this.socket.send(JSON.stringify(msg));
      return;
    }
    this.queue.push(msg);
    if (this.queue.length > MAX_QUEUE) {
      this.queue.splice(0, this.queue.length - MAX_QUEUE);
    }
  }

  close() {
    this.stopped = true;
    this.queue = [];
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setState("closed");
  }
}
