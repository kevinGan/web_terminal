import * as pty from 'node-pty';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { OscSniffer } from './osc-parser.js';

type DataListener = (chunk: Buffer) => void;
type ExitListener = (code: { exitCode: number; signal?: number }) => void;
type CwdListener = (path: string) => void;
type TitleListener = (text: string) => void;

export interface SessionInit {
  id: string;
  shell: string;
  shellArgs: string[];
  cols: number;
  rows: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  zdotdir?: string | null;
}

export class PTYSession {
  readonly id: string;
  readonly createdAt = Date.now();
  cwd: string;
  title = '';
  cols: number;
  rows: number;

  private pty: pty.IPty;
  private sniffer: OscSniffer;
  private dataListeners = new Set<DataListener>();
  private exitListeners = new Set<ExitListener>();
  private cwdListeners = new Set<CwdListener>();
  private titleListeners = new Set<TitleListener>();
  private alive = true;
  private buffer: Buffer[] = [];
  private bufferBytes = 0;
  // ~2 MB ≈ ~30k lines of typical CLI output. Large enough that "refresh and
  // pick up where I left off" feels seamless without ballooning RAM.
  private readonly maxBufferBytes = 2 * 1024 * 1024;

  constructor(init: SessionInit) {
    this.id = init.id;
    this.cols = init.cols;
    this.rows = init.rows;

    const homeCwd = homedir();
    const wantedCwd = init.cwd && existsSync(init.cwd) ? init.cwd : homeCwd;
    this.cwd = wantedCwd;

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...init.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8',
      WEB_TERMINAL: '1'
    };

    const shellName = basename(init.shell);
    const useZWrapper = init.zdotdir && (shellName === 'zsh');
    if (useZWrapper) {
      env.WEBTERM_USER_HOME = process.env.HOME || homedir();
      env.WEBTERM_USER_ZDOTDIR = process.env.ZDOTDIR || env.WEBTERM_USER_HOME;
      env.ZDOTDIR = init.zdotdir!;
    }

    this.pty = pty.spawn(init.shell, init.shellArgs, {
      name: 'xterm-256color',
      cols: init.cols,
      rows: init.rows,
      cwd: wantedCwd,
      env: env as { [key: string]: string }
    });

    this.sniffer = new OscSniffer({
      onCwd: (path) => {
        if (path && path !== this.cwd) {
          this.cwd = path;
          for (const l of this.cwdListeners) l(path);
        }
      },
      onTitle: (text) => {
        if (text !== this.title) {
          this.title = text;
          for (const l of this.titleListeners) l(text);
        }
      }
    });

    this.pty.onData((data) => {
      const buf = Buffer.from(data, 'utf8');
      this.sniffer.feed(buf);
      this.appendBuffer(buf);
      for (const l of this.dataListeners) l(buf);
    });

    this.pty.onExit(({ exitCode, signal }) => {
      this.alive = false;
      const ev = { exitCode, signal };
      for (const l of this.exitListeners) l(ev);
    });
  }

  get isAlive(): boolean { return this.alive; }

  write(data: string | Buffer): void {
    if (!this.alive) return;
    this.pty.write(typeof data === 'string' ? data : data.toString('utf8'));
  }

  resize(cols: number, rows: number): void {
    if (!this.alive) return;
    if (cols <= 0 || rows <= 0) return;
    this.cols = cols;
    this.rows = rows;
    try { this.pty.resize(cols, rows); } catch {}
  }

  kill(signal?: string): void {
    try { this.pty.kill(signal); } catch {}
    this.alive = false;
  }

  /** Attach a transient consumer (e.g. on WS reconnect). Returns disposer. */
  onData(listener: DataListener): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }
  onExit(listener: ExitListener): () => void {
    this.exitListeners.add(listener);
    if (!this.alive) listener({ exitCode: 0 });
    return () => this.exitListeners.delete(listener);
  }
  onCwd(listener: CwdListener): () => void {
    this.cwdListeners.add(listener);
    return () => this.cwdListeners.delete(listener);
  }
  onTitle(listener: TitleListener): () => void {
    this.titleListeners.add(listener);
    return () => this.titleListeners.delete(listener);
  }

  /** Snapshot of recent output for replay on reconnect. */
  snapshot(): Buffer {
    return Buffer.concat(this.buffer);
  }

  private appendBuffer(chunk: Buffer): void {
    this.buffer.push(chunk);
    this.bufferBytes += chunk.length;
    while (this.bufferBytes > this.maxBufferBytes && this.buffer.length > 1) {
      const first = this.buffer.shift()!;
      this.bufferBytes -= first.length;
    }
  }
}
