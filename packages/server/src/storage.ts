import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

export class JsonStore<T> {
  private cache: T | null = null;
  constructor(
    private readonly file: string,
    private readonly defaultValue: () => T
  ) {}

  read(): T {
    if (this.cache != null) return this.cache;
    if (!existsSync(this.file)) {
      this.cache = this.defaultValue();
      return this.cache;
    }
    try {
      this.cache = JSON.parse(readFileSync(this.file, 'utf8')) as T;
      return this.cache;
    } catch {
      this.cache = this.defaultValue();
      return this.cache;
    }
  }

  write(value: T): void {
    this.cache = value;
    mkdirSync(this.file.slice(0, this.file.lastIndexOf('/')), { recursive: true });
    writeFileSync(this.file, JSON.stringify(value, null, 2), 'utf8');
  }

  update(fn: (cur: T) => T): T {
    const next = fn(this.read());
    this.write(next);
    return next;
  }
}

export interface Bookmark {
  id: string;
  label: string;
  path: string;
  addedAt: number;
}

export interface Snippet {
  id: string;
  label: string;
  command: string;
  addedAt: number;
}

export interface ClaudeCommand {
  id: string;
  label: string;
  /** Text typed into the terminal; usually starts with `/` for Claude slash commands. */
  command: string;
  /** If true, command is sent + Enter pressed; if false, only typed (user can edit). */
  autoSubmit?: boolean;
  addedAt: number;
}

export function ensureDataDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch {}
}

export function bookmarkStore(dataDir: string) {
  return new JsonStore<Bookmark[]>(join(dataDir, 'bookmarks.json'), () => []);
}

/**
 * Workspace state: opened tabs, their pane trees, active leaf, etc.
 * The shape is defined by the frontend (it's an opaque blob to the server).
 * We just round-trip JSON so that refresh / cross-browser preserves the layout.
 */
export interface WorkspaceState {
  schemaVersion: number;
  tabs: unknown[];
  activeTabId: string;
  /** Monotonic counter shared with client `newId` so post-hydrate ids never collide with persisted ones. */
  idCounter: number;
}

export function workspaceStore(dataDir: string) {
  return new JsonStore<WorkspaceState>(join(dataDir, 'state.json'), () => ({
    schemaVersion: 1,
    tabs: [],
    activeTabId: '',
    idCounter: 0
  }));
}

export function snippetStore(dataDir: string) {
  return new JsonStore<Snippet[]>(join(dataDir, 'snippets.json'), () => defaultSnippets());
}

function defaultSnippets(): Snippet[] {
  const now = Date.now();
  return [
    { id: 's1', label: 'git status', command: 'git status', addedAt: now },
    { id: 's2', label: 'git pull', command: 'git pull --rebase', addedAt: now },
    { id: 's3', label: 'docker ps', command: 'docker ps', addedAt: now },
    { id: 's4', label: 'ports', command: 'lsof -i -P -n | grep LISTEN', addedAt: now }
  ];
}

export function claudeCommandStore(dataDir: string) {
  return new JsonStore<ClaudeCommand[]>(join(dataDir, 'claude-commands.json'), () => defaultClaudeCommands());
}

function defaultClaudeCommands(): ClaudeCommand[] {
  const now = Date.now();
  return [
    { id: 'cc1', label: '/clear', command: '/clear', autoSubmit: true, addedAt: now },
    { id: 'cc2', label: '/compact', command: '/compact', autoSubmit: true, addedAt: now },
    { id: 'cc3', label: '/review', command: '/review', autoSubmit: true, addedAt: now },
    { id: 'cc4', label: 'commit and push', command: 'commit and push', autoSubmit: true, addedAt: now },
    { id: 'cc5', label: '/status', command: '/status', autoSubmit: true, addedAt: now },
    { id: 'cc6', label: '/effort', command: '/effort', autoSubmit: true, addedAt: now }
  ];
}

/**
 * One-shot migration: append any default commands the user is missing,
 * then drop a marker file so we don't re-add them later if they deleted them.
 * Idempotent — safe to call on every startup.
 *
 * The marker is keyed by a "seed version" number. Bumping the version when
 * we add new default commands triggers another append pass once.
 */
const CURRENT_SEED_VERSION = 2;

export function seedClaudeCommandsIfNeeded(dataDir: string): void {
  const file = join(dataDir, 'claude-commands.json');
  const markerFile = join(dataDir, 'claude-commands.seeded');
  if (!existsSync(file)) return; // first run uses defaults via the store

  let lastSeen = 0;
  if (existsSync(markerFile)) {
    try {
      lastSeen = Number(readFileSync(markerFile, 'utf8').trim()) || 0;
    } catch {}
  }
  if (lastSeen >= CURRENT_SEED_VERSION) return;

  const store = claudeCommandStore(dataDir);
  const cur = store.read();
  const haveCommands = new Set(cur.map((c) => c.command));
  const defaults = defaultClaudeCommands();
  const missing = defaults.filter((d) => !haveCommands.has(d.command));
  if (missing.length > 0) {
    store.write([...cur, ...missing]);
  }
  writeFileSync(markerFile, String(CURRENT_SEED_VERSION), { encoding: 'utf8', mode: 0o644 });
}
