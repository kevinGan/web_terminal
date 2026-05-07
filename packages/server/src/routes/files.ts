import type { FastifyInstance } from 'fastify';
import { realpath, readdir, stat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename, dirname } from 'node:path';

interface Entry {
  name: string;
  path: string;
  type: 'dir' | 'file' | 'symlink' | 'other';
  size?: number;
  mtimeMs?: number;
}

const MAX_PREVIEW_BYTES = 1 * 1024 * 1024;

export async function registerFiles(app: FastifyInstance, allowedRoots: string[]) {
  const resolved = allowedRoots.map((p) => p.replace(/^~/, homedir()));

  function withinAllowed(p: string): boolean {
    return resolved.some((root) => p === root || p.startsWith(root.endsWith('/') ? root : root + '/'));
  }

  async function safeResolve(p: string): Promise<string | null> {
    if (!p) return null;
    const expanded = p.replace(/^~/, homedir());
    try {
      const r = await realpath(expanded);
      return withinAllowed(r) ? r : null;
    } catch {
      return null;
    }
  }

  app.get<{ Querystring: { path?: string; showHidden?: string } }>('/api/files', async (req, reply) => {
    const requested = req.query.path?.trim() || homedir();
    const showHidden = req.query.showHidden === '1' || req.query.showHidden === 'true';
    const real = await safeResolve(requested);
    if (!real) {
      reply.code(403); return { error: 'forbidden_path', path: requested };
    }
    const st = await stat(real);
    if (!st.isDirectory()) {
      reply.code(400); return { error: 'not_a_directory', path: real };
    }
    const names = await readdir(real);
    const entries: Entry[] = [];
    for (const name of names) {
      if (!showHidden && name.startsWith('.')) continue;
      const full = join(real, name);
      try {
        const s = await stat(full);
        entries.push({
          name,
          path: full,
          type: s.isDirectory() ? 'dir' : s.isSymbolicLink() ? 'symlink' : s.isFile() ? 'file' : 'other',
          size: s.isFile() ? s.size : undefined,
          mtimeMs: s.mtimeMs
        });
      } catch {
        entries.push({ name, path: full, type: 'other' });
      }
    }
    entries.sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name);
    });
    return { path: real, parent: dirname(real), entries };
  });

  app.get<{ Querystring: { path?: string } }>('/api/files/read', async (req, reply) => {
    const p = req.query.path?.trim();
    if (!p) { reply.code(400); return { error: 'path required' }; }
    const real = await safeResolve(p);
    if (!real) { reply.code(403); return { error: 'forbidden_path' }; }
    const st = await stat(real);
    if (!st.isFile()) { reply.code(400); return { error: 'not_a_file' }; }
    if (st.size > MAX_PREVIEW_BYTES) {
      reply.code(413); return { error: 'file_too_large', size: st.size, maxSize: MAX_PREVIEW_BYTES };
    }
    const data = await readFile(real);
    if (looksBinary(data)) {
      return { name: basename(real), path: real, size: st.size, binary: true };
    }
    return { name: basename(real), path: real, size: st.size, content: data.toString('utf8') };
  });

  app.get('/api/files/roots', async () => {
    return { roots: resolved };
  });
}

function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i]!;
    if (b === 0) return true;
  }
  return false;
}
