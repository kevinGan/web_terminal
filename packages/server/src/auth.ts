import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyRequest, FastifyReply } from 'fastify';

function persistToken(dataDir: string, tok: string): void {
  const file = join(dataDir, 'token');
  writeFileSync(file, tok + '\n', { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(file, 0o600); } catch {}
}

export function loadOrCreateToken(dataDir: string): string {
  const file = join(dataDir, 'token');
  if (existsSync(file)) {
    const tok = readFileSync(file, 'utf8').trim();
    // Accept any non-empty token previously written by the user; only fall back
    // to fresh generation if the file is empty/whitespace.
    if (tok.length >= 1) return tok;
  }
  const tok = randomBytes(32).toString('hex');
  persistToken(dataDir, tok);
  return tok;
}

export function rotateToken(dataDir: string): string {
  const tok = randomBytes(32).toString('hex');
  persistToken(dataDir, tok);
  return tok;
}

/** Persist a user-supplied token. Caller is responsible for non-empty validation. */
export function writeToken(dataDir: string, tok: string): void {
  persistToken(dataDir, tok);
}

export interface AuthOptions {
  token: string;
  enabled: boolean;
}

/**
 * Token check accepts:
 *   - Authorization: Bearer <token>
 *   - x-wt-token: <token>
 *   - ?token=<token>  (for initial bootstrap and WS upgrade)
 */
export function extractToken(req: FastifyRequest): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const x = req.headers['x-wt-token'];
  if (typeof x === 'string') return x.trim();
  const q = (req.query as { token?: string } | undefined)?.token;
  if (q) return q.trim();
  return null;
}

export function makeAuthHook(opts: AuthOptions) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!opts.enabled) return;
    const tok = extractToken(req);
    if (!tok || !timingSafeEqualStr(tok, opts.token)) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  };
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
