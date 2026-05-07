import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

interface CdEntry {
  path: string;
  count: number;
  lastUsed: number;
}

const cache = new Map<string, { mtimeMs: number; entries: CdEntry[] }>();

export async function registerHistory(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string } }>('/api/history/cd', async (req) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 30)));
    const file = process.env.HISTFILE || join(homedir(), '.zsh_history');
    if (!existsSync(file)) return { entries: [], file };
    const stat = statSync(file);
    const cached = cache.get(file);
    let entries: CdEntry[];
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      entries = cached.entries;
    } else {
      entries = parse(file);
      cache.set(file, { mtimeMs: stat.mtimeMs, entries });
    }
    return { entries: entries.slice(0, limit), file };
  });
}

/**
 * Parse zsh extended history (`: <ts>:<dur>;<cmd>`) and aggregate `cd <path>` targets.
 */
function parse(file: string): CdEntry[] {
  let raw: string;
  try {
    raw = readFileSync(file, { encoding: 'latin1' });
  } catch {
    return [];
  }
  const counts = new Map<string, { count: number; lastUsed: number }>();
  const home = homedir();
  const lines = foldContinuations(raw.split('\n'));
  for (const line of lines) {
    const cmd = stripExtendedPrefix(line);
    if (!cmd) continue;
    const ts = extractTimestamp(line);
    const target = parseCdTarget(cmd);
    if (!target) continue;
    const normalized = normalizePath(target, home);
    if (!normalized) continue;
    const cur = counts.get(normalized);
    if (cur) {
      cur.count++;
      if (ts > cur.lastUsed) cur.lastUsed = ts;
    } else {
      counts.set(normalized, { count: 1, lastUsed: ts });
    }
  }
  return [...counts.entries()]
    .map(([path, { count, lastUsed }]) => ({ path, count, lastUsed }))
    .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed);
}

function foldContinuations(lines: string[]): string[] {
  const out: string[] = [];
  let acc = '';
  for (const line of lines) {
    if (line.endsWith('\\')) {
      acc += line.slice(0, -1) + '\n';
    } else {
      out.push(acc + line);
      acc = '';
    }
  }
  if (acc) out.push(acc);
  return out;
}

function stripExtendedPrefix(line: string): string | null {
  if (!line) return null;
  if (line.startsWith(': ')) {
    const semi = line.indexOf(';');
    if (semi === -1) return null;
    return line.slice(semi + 1).trim();
  }
  return line.trim();
}

function extractTimestamp(line: string): number {
  if (!line.startsWith(': ')) return 0;
  const colon = line.indexOf(':', 2);
  if (colon === -1) return 0;
  const tsStr = line.slice(2, colon).trim();
  const ts = Number(tsStr);
  return Number.isFinite(ts) ? ts * 1000 : 0;
}

function parseCdTarget(cmd: string): string | null {
  const m = cmd.match(/^\s*(?:builtin\s+)?cd\s+(?:--\s+)?(.+?)\s*(?:#.*)?$/);
  if (!m) return null;
  let arg = m[1]!;
  const sp = arg.match(/\s/);
  if (sp && sp.index !== undefined) arg = arg.slice(0, sp.index);
  if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
    arg = arg.slice(1, -1);
  }
  if (!arg || arg === '-' || arg === '..' || arg === '.') return null;
  return arg;
}

function normalizePath(path: string, home: string): string | null {
  if (path.startsWith('~')) return home + path.slice(1);
  if (path.startsWith('$HOME')) return home + path.slice('$HOME'.length);
  if (path.startsWith('/')) return path;
  return null;
}
