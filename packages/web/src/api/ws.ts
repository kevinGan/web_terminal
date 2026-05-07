import { getToken } from './token';

export type WsControlIn =
  | { type: 'ready'; sessionId: string; cwd: string; title: string }
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
  onClose: (event: { code: number; reason: string }) => void;
}

export class PtyConn {
  private ws: WebSocket | null = null;
  private closed = false;
  private queue: Array<Uint8Array | string> = [];

  constructor(
    private readonly init: () => WsControlOut,
    private readonly handlers: PtyConnHandlers
  ) {}

  open(): void {
    const token = getToken();
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws/terminal${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify(this.init()));
      // flush queue
      for (const m of this.queue) {
        if (typeof m === 'string') ws.send(m);
        else ws.send(m);
      }
      this.queue = [];
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
      this.closed = true;
      this.handlers.onClose({ code: ev.code, reason: ev.reason });
    });
    ws.addEventListener('error', () => {
      // 'close' fires after this for actual disconnect.
    });
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
    this.closed = true;
    try { this.ws?.close(1000, 'client_close'); } catch {}
  }

  get isClosed() { return this.closed; }
}
