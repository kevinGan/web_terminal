import type { FastifyInstance } from 'fastify';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve as pathResolve, relative as pathRelative, isAbsolute } from 'node:path';
import { runGit } from '../git/exec.js';

export type ChangeKind = 'staged' | 'unstaged' | 'untracked';
export type ChangeStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?';

export interface ChangeEntry {
  path: string;
  oldPath?: string;
  status: ChangeStatus;
  adds?: number;
  dels?: number;
}

export interface StatusResponse {
  isRepo: boolean;
  cwd: string;
  root?: string;
  branch?: string;
  head?: string;
  staged: ChangeEntry[];
  unstaged: ChangeEntry[];
  untracked: ChangeEntry[];
  error?: string;
}

const MAX_DIFF_BYTES = 1 * 1024 * 1024;

export async function registerGit(app: FastifyInstance, allowedRoots: string[]) {
  const resolvedRoots = allowedRoots.map((p) => p.replace(/^~/, homedir()));

  function withinAllowed(p: string): boolean {
    return resolvedRoots.some(
      (root) => p === root || p.startsWith(root.endsWith('/') ? root : root + '/')
    );
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

  app.get<{ Querystring: { cwd?: string } }>('/api/git/status', async (req, reply) => {
    const requested = req.query.cwd?.trim();
    if (!requested) {
      reply.code(400);
      return { error: 'cwd_required' };
    }
    const real = await safeResolve(requested);
    if (!real) {
      reply.code(403);
      return { error: 'forbidden_path', path: requested };
    }

    const repoCheck = await runGit(real, ['rev-parse', '--is-inside-work-tree']);
    if (repoCheck.code !== 0 || repoCheck.stdout.trim() !== 'true') {
      // Log unexpected failures (git not on PATH, permission errors). A plain
      // "not a repo" yields code 128 with stderr "fatal: not a git repository";
      // that's normal and we surface it as isRepo:false without warning noise.
      const stderr = repoCheck.stderr || '';
      if (!/not a git repository/i.test(stderr)) {
        app.log.warn({ cwd: real, stderr, code: repoCheck.code }, 'git rev-parse --is-inside-work-tree unexpected failure');
      }
      const resp: StatusResponse = {
        isRepo: false,
        cwd: real,
        staged: [],
        unstaged: [],
        untracked: []
      };
      return resp;
    }

    const [topRes, branchRes, headRes, porcelainRes, numUnRes, numStRes] = await Promise.all([
      runGit(real, ['rev-parse', '--show-toplevel']),
      runGit(real, ['rev-parse', '--abbrev-ref', 'HEAD']),
      runGit(real, ['rev-parse', '--short', 'HEAD']),
      runGit(real, [
        '-c',
        'core.quotepath=false',
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all'
      ]),
      runGit(real, ['-c', 'core.quotepath=false', 'diff', '--numstat', '-z', '--no-ext-diff', '-M']),
      runGit(real, [
        '-c',
        'core.quotepath=false',
        'diff',
        '--cached',
        '--numstat',
        '-z',
        '--no-ext-diff',
        '-M'
      ])
    ]);

    const root = topRes.code === 0 ? topRes.stdout.trim() : real;
    const branch = branchRes.code === 0 ? branchRes.stdout.trim() : undefined;
    const head = headRes.code === 0 ? headRes.stdout.trim() : undefined;

    const numUn = parseNumstatZ(numUnRes.stdout);
    const numSt = parseNumstatZ(numStRes.stdout);

    const groups = parsePorcelainZ(porcelainRes.stdout, numUn, numSt);

    const resp: StatusResponse = {
      isRepo: true,
      cwd: real,
      root,
      branch,
      head,
      ...groups
    };
    return resp;
  });

  app.get<{ Querystring: { cwd?: string; file?: string; kind?: string } }>(
    '/api/git/diff',
    async (req, reply) => {
      const requested = req.query.cwd?.trim();
      const file = req.query.file?.trim();
      const kindRaw = req.query.kind?.trim();
      if (!requested || !file || !kindRaw) {
        reply.code(400);
        return { error: 'cwd_file_kind_required' };
      }
      if (kindRaw !== 'staged' && kindRaw !== 'unstaged' && kindRaw !== 'untracked') {
        reply.code(400);
        return { error: 'invalid_kind' };
      }
      const kind = kindRaw as ChangeKind;

      const real = await safeResolve(requested);
      if (!real) {
        reply.code(403);
        return { error: 'forbidden_path' };
      }

      // Confirm we're actually in a repo. Frontend-supplied `file` paths from
      // the status endpoint are relative to `real` (since git was invoked with
      // -C real), so we validate against `real` — not the toplevel — to keep
      // bases aligned with command execution below.
      const topRes = await runGit(real, ['rev-parse', '--show-toplevel']);
      if (topRes.code !== 0) {
        app.log.warn({ cwd: real, stderr: topRes.stderr, code: topRes.code }, 'git rev-parse failed');
        reply.code(400);
        return { error: 'not_a_repo' };
      }

      if (isAbsolute(file)) {
        reply.code(400);
        return { error: 'file_must_be_relative' };
      }
      const absFile = pathResolve(real, file);
      const rel = pathRelative(real, absFile);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        reply.code(403);
        return { error: 'file_outside_cwd' };
      }

      let args: string[];
      if (kind === 'staged') {
        args = ['-c', 'core.quotepath=false', 'diff', '--cached', '--no-color', '--no-ext-diff', '-M', '--', file];
      } else if (kind === 'unstaged') {
        args = ['-c', 'core.quotepath=false', 'diff', '--no-color', '--no-ext-diff', '-M', '--', file];
      } else {
        // untracked: synthesize patch by diffing /dev/null against the file
        args = ['-c', 'core.quotepath=false', 'diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', file];
      }

      const result = await runGit(real, args, { maxBuffer: MAX_DIFF_BYTES + 64 * 1024 });
      // For --no-index, git exits 1 when files differ — that's expected and patch is in stdout.
      // For other diff kinds, a non-zero with empty stdout usually means a real failure.
      if (result.code !== 0 && kind !== 'untracked' && !result.stdout) {
        app.log.warn({ cwd: real, file, kind, stderr: result.stderr, code: result.code }, 'git diff failed');
      }
      const patch = result.stdout;
      const isBinary = /^Binary files .* differ$/m.test(patch);
      const byteLen = Buffer.byteLength(patch, 'utf8');
      const truncated = byteLen > MAX_DIFF_BYTES;

      // Truncate by bytes, not characters — `String.slice` would split UTF-8
      // multi-byte sequences mid-codepoint and yield invalid output.
      // Buffer's utf8 decoder gracefully drops trailing incomplete bytes.
      const safePatch = truncated
        ? Buffer.from(patch, 'utf8').subarray(0, MAX_DIFF_BYTES).toString('utf8')
        : patch;

      return {
        path: file,
        kind,
        binary: isBinary || undefined,
        truncated: truncated || undefined,
        patch: safePatch
      };
    }
  );
}

// Parse `git diff --numstat -z` output → Map<path, {adds, dels}>.
// Format: "<adds>\t<dels>\t<path>\0"   or for renames: "<adds>\t<dels>\0<old>\0<new>\0"
function parseNumstatZ(out: string): Map<string, { adds: number; dels: number }> {
  const map = new Map<string, { adds: number; dels: number }>();
  let i = 0;
  while (i < out.length) {
    // Read up to the next NUL: that's the "<adds>\t<dels>\t<path>" or "<adds>\t<dels>" prefix.
    const nul = out.indexOf('\0', i);
    if (nul === -1) break;
    const head = out.slice(i, nul);
    const parts = head.split('\t');
    if (parts.length === 3) {
      const adds = parts[0] === '-' ? 0 : Number(parts[0]) || 0;
      const dels = parts[1] === '-' ? 0 : Number(parts[1]) || 0;
      map.set(parts[2]!, { adds, dels });
      i = nul + 1;
    } else if (parts.length === 2) {
      // Rename: next two NUL-delimited fields are old and new path.
      const adds = parts[0] === '-' ? 0 : Number(parts[0]) || 0;
      const dels = parts[1] === '-' ? 0 : Number(parts[1]) || 0;
      const nul2 = out.indexOf('\0', nul + 1);
      if (nul2 === -1) break;
      const nul3 = out.indexOf('\0', nul2 + 1);
      if (nul3 === -1) break;
      const newPath = out.slice(nul2 + 1, nul3);
      map.set(newPath, { adds, dels });
      i = nul3 + 1;
    } else {
      // Unrecognized — stop to avoid infinite loop.
      break;
    }
  }
  return map;
}

// Parse `git status --porcelain=v1 -z` output.
//
// Each record is "XY <path>\0", where XY are two status chars:
//   X = index (staged) status, Y = worktree (unstaged) status.
// Renames (R) and copies (C) attach the prior path: "R  new\0old\0".
// Untracked is "?? <path>\0".
// Files with both staged and unstaged changes (e.g. "MM") appear in both groups —
// each group's diff endpoint returns its own patch.
function parsePorcelainZ(
  out: string,
  numUn: Map<string, { adds: number; dels: number }>,
  numSt: Map<string, { adds: number; dels: number }>
): { staged: ChangeEntry[]; unstaged: ChangeEntry[]; untracked: ChangeEntry[] } {
  const staged: ChangeEntry[] = [];
  const unstaged: ChangeEntry[] = [];
  const untracked: ChangeEntry[] = [];

  let i = 0;
  while (i < out.length) {
    if (out.length - i < 3) break;
    const x = out[i]!;
    const y = out[i + 1]!;
    // i+2 is the space separator
    const nul = out.indexOf('\0', i + 3);
    if (nul === -1) break;
    let path = out.slice(i + 3, nul);
    let oldPath: string | undefined;
    i = nul + 1;

    // Renames/copies in either index or worktree slot include a second NUL-terminated old path.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      const nul2 = out.indexOf('\0', i);
      if (nul2 === -1) break;
      oldPath = out.slice(i, nul2);
      i = nul2 + 1;
    }

    if (x === '?' && y === '?') {
      untracked.push({ path, status: '?' });
      continue;
    }

    if (x !== ' ' && x !== '?') {
      const stat = normalizeStatus(x);
      const num = numSt.get(path);
      staged.push({ path, oldPath, status: stat, adds: num?.adds, dels: num?.dels });
    }
    if (y !== ' ' && y !== '?') {
      const stat = normalizeStatus(y);
      const num = numUn.get(path);
      unstaged.push({ path, oldPath, status: stat, adds: num?.adds, dels: num?.dels });
    }
  }

  return { staged, unstaged, untracked };
}

function normalizeStatus(c: string): ChangeStatus {
  switch (c) {
    case 'M':
    case 'A':
    case 'D':
    case 'R':
    case 'C':
    case 'T':
    case 'U':
      return c;
    default:
      return 'M';
  }
}
