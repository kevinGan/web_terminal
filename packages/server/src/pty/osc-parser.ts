/**
 * Stream-based OSC sniffer.
 * Parses ESC ] <code> ; <payload> (BEL | ESC \) for two ids:
 *   - 0 / 2 : window title (xterm)
 *   - 1337 ; CurrentDir=<path> : iTerm2-style cwd notification
 *
 * It does NOT consume bytes from the stream — it only inspects them.
 * Designed for arbitrarily chunked input (state survives across writes).
 */

const ESC = 0x1b;
const BEL = 0x07;
const BACKSLASH = 0x5c;
const RBRACKET = 0x5d;
const SEMI = 0x3b;
const MAX_PAYLOAD = 4096;

type State = 'normal' | 'esc' | 'osc' | 'osc-st';

export interface OscEvents {
  onTitle?: (text: string) => void;
  onCwd?: (path: string) => void;
}

export class OscSniffer {
  private state: State = 'normal';
  private buf: number[] = [];
  private idCache = '';
  private payloadStart = -1;
  constructor(private readonly events: OscEvents) {}

  feed(chunk: Buffer | string): void {
    const data = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    for (let i = 0; i < data.length; i++) {
      const b = data[i]!;
      switch (this.state) {
        case 'normal':
          if (b === ESC) this.state = 'esc';
          break;
        case 'esc':
          if (b === RBRACKET) {
            this.state = 'osc';
            this.buf = [];
            this.idCache = '';
            this.payloadStart = -1;
          } else {
            this.state = 'normal';
          }
          break;
        case 'osc':
          if (b === BEL) {
            this.dispatch();
            this.reset();
          } else if (b === ESC) {
            this.state = 'osc-st';
          } else {
            if (this.buf.length < MAX_PAYLOAD) this.buf.push(b);
            if (this.payloadStart === -1 && b === SEMI) {
              this.payloadStart = this.buf.length;
            }
          }
          break;
        case 'osc-st':
          if (b === BACKSLASH) {
            this.dispatch();
            this.reset();
          } else {
            // false alarm, drop
            this.reset();
          }
          break;
      }
    }
  }

  private dispatch(): void {
    if (this.payloadStart === -1) return;
    const idStr = Buffer.from(this.buf.slice(0, this.payloadStart - 1)).toString('utf8');
    const payload = Buffer.from(this.buf.slice(this.payloadStart)).toString('utf8');
    if (idStr === '0' || idStr === '2') {
      this.events.onTitle?.(payload);
      return;
    }
    if (idStr === '1337') {
      const eq = payload.indexOf('=');
      if (eq > 0) {
        const key = payload.slice(0, eq);
        const val = payload.slice(eq + 1);
        if (key === 'CurrentDir') this.events.onCwd?.(val);
      }
      return;
    }
    if (idStr === '7') {
      // OSC 7: file://host/path  (ConEmu / VTE / WezTerm style)
      try {
        const u = new URL(payload);
        if (u.protocol === 'file:') this.events.onCwd?.(decodeURIComponent(u.pathname));
      } catch {}
    }
  }

  private reset(): void {
    this.state = 'normal';
    this.buf = [];
    this.payloadStart = -1;
  }
}
