import { randomUUID } from 'node:crypto';
import { PTYSession, type SessionInit } from './session.js';
import { ensureZDotDir } from './zdotdir.js';
import type { Config } from '../config.js';

interface PendingDispose {
  timer: NodeJS.Timeout;
}

export class SessionManager {
  private sessions = new Map<string, PTYSession>();
  private pending = new Map<string, PendingDispose>();
  private zdotdir: string | null = null;

  constructor(private readonly config: Config) {
    try {
      this.zdotdir = ensureZDotDir(config.dataDir);
    } catch {
      this.zdotdir = null;
    }
  }

  list(): { id: string; cwd: string; title: string; alive: boolean; createdAt: number }[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      cwd: s.cwd,
      title: s.title,
      alive: s.isAlive,
      createdAt: s.createdAt
    }));
  }

  get(id: string): PTYSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Create a new session, or reattach to an existing one if id is provided.
   * Reattaching cancels the soft-close timer.
   */
  attachOrCreate(opts: { id?: string; cols: number; rows: number; cwd?: string }): PTYSession {
    if (opts.id) {
      const existing = this.sessions.get(opts.id);
      if (existing && existing.isAlive) {
        const pending = this.pending.get(opts.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(opts.id);
        }
        existing.resize(opts.cols, opts.rows);
        return existing;
      }
    }
    const id = opts.id && !this.sessions.has(opts.id) ? opts.id : randomUUID();
    const init: SessionInit = {
      id,
      shell: this.config.shell,
      shellArgs: this.config.shellArgs,
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      zdotdir: this.zdotdir
    };
    const session = new PTYSession(init);
    session.onExit(() => {
      // Defer removal so a fast WS reconnect can still see exit state.
      setTimeout(() => this.sessions.delete(id), 1_000);
    });
    this.sessions.set(id, session);
    return session;
  }

  /** Schedule disposal in N ms unless reattached. */
  softClose(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    const existing = this.pending.get(id);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      session.kill();
      this.sessions.delete(id);
      this.pending.delete(id);
    }, this.config.ptySoftCloseMs);
    this.pending.set(id, { timer });
  }

  /** Hard-kill and remove. */
  destroy(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.kill();
    const pending = this.pending.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
    }
    this.sessions.delete(id);
  }

  destroyAll(): void {
    for (const id of [...this.sessions.keys()]) this.destroy(id);
  }
}
