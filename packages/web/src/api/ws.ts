import { getToken } from './token';

export type WsControlIn =
  | { type: 'ready'; sessionId: string; cwd: string; title: string; replayed?: boolean }
  | { type: 'cwd'; path: string }
  | { type: 'title'; text: string }
  | { type: 'exit'; exitCode: number; signal?: number }
  | { type: 'pong' };

export type WsControlOut =
  | { type: 'init'; sessionId?: string; cols: number; rows: number; cwd?: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ping' };

export interface PtyConnHandlers {
  onBinary: (data: Uint8Array) => void;
  onControl: (msg: WsControlIn) => void;
  /** Fires once per WS close (each disconnect, including reconnect retries). */
  onClose: (event: { code: number; reason: string }) => void;
  /** Optional: fires whenever a fresh WS becomes OPEN (initial + each reconnect). */
  onOpen?: () => void;
  /** Optional: fires when reconnect attempts begin / end. */
  onReconnecting?: (info: { attempt: number; delayMs: number }) => void;
}

// Auth/policy close codes from our server — no point retrying these.
const TERMINAL_CLOSE_CODES = new Set([1000, 1001, 1005, 4001, 4003]);
const MAX_BACKOFF_MS = 10_000;
const BASE_BACKOFF_MS = 500;

export class PtyConn {
  private ws: WebSocket | null = null;
  private disposed = false;
  private queue: Array<Uint8Array | string> = [];
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly init: () => WsControlOut,
    private readonly handlers: PtyConnHandlers
  ) {}

  open(): void {
    if (this.disposed) return;
    const token = getToken();
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws/terminal${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      // Synchronous construction failure (rare). Schedule a retry.
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.retryCount = 0;
      ws.send(JSON.stringify(this.init()));
      // flush queue
      for (const m of this.queue) {
        if (typeof m === 'string') ws.send(m);
        else ws.send(m);
      }
      this.queue = [];
      this.handlers.onOpen?.();
    });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data) as WsControlIn;
          this.handlers.onControl(msg);
        } catch {}
      } else {
        const buf = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : new Uint8Array(0);
        this.handlers.onBinary(buf);
      }
    });
    ws.addEventListener('close', (ev) => {
      this.ws = null;
      this.handlers.onClose({ code: ev.code, reason: ev.reason });
      // Server-imposed terminal codes (auth/policy/clean exit) → don't retry.
      // Anything else (network blip, server restart, transient error) → retry.
      if (this.disposed) return;
      if (TERMINAL_CLOSE_CODES.has(ev.code)) return;
      this.scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      // 'close' fires after this for actual disconnect.
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.retryTimer) return;
    // Exponential backoff with jitter, capped at MAX_BACKOFF_MS.
    const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(1.5, this.retryCount));
    const delayMs = Math.floor(exp * (0.7 + Math.random() * 0.6));
    this.retryCount++;
    this.handlers.onReconnecting?.({ attempt: this.retryCount, delayMs });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delayMs);
  }

  /** Force an immediate reconnect attempt (cancels any pending backoff). */
  reconnectNow(): void {
    if (this.disposed) return;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.open();
  }

  /** Send raw stdin bytes. */
  sendInput(data: Uint8Array | string): void {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.queue.push(bytes);
      return;
    }
    this.ws.send(bytes);
  }

  /** Send a JSON control frame. */
  sendControl(msg: WsControlOut): void {
    const text = JSON.stringify(msg);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.queue.push(text);
      return;
    }
    this.ws.send(text);
  }

  resize(cols: number, rows: number): void {
    this.sendControl({ type: 'resize', cols, rows });
  }

  close(): void {
    this.disposed = true;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    try { this.ws?.close(1000, 'client_close'); } catch {}
  }

  get isClosed() { return this.disposed; }
}
