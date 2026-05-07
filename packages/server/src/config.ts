import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  host: string;
  port: number;
  noAuth: boolean;
  dataDir: string;
  staticDir: string | null;
  shell: string;
  shellArgs: string[];
  allowedRoots: string[];
  ptySoftCloseMs: number;
}

const HOME = homedir();

export function loadConfig(argv: string[]): Config {
  const args = parseArgs(argv);
  const str = (k: string): string | undefined => {
    const v = args[k];
    return typeof v === 'string' ? v : undefined;
  };
  const host = str('host') ?? '0.0.0.0';
  const port = Number(str('port') ?? process.env.WT_PORT ?? 7681);
  const noAuth = !!args['no-token'];
  const dataDir = str('data-dir') ?? join(HOME, '.web_terminal');
  const staticDir = str('static-dir') ?? null;
  const shell = process.env.SHELL || '/bin/zsh';
  const allowedRoots = (str('allow-root') ?? `${HOME}:/tmp:/Users:/Volumes`).split(':').filter(Boolean);
  return {
    host,
    port,
    noAuth,
    dataDir,
    staticDir,
    shell,
    shellArgs: ['-l', '-i'],
    allowedRoots,
    // Keep PTY alive long enough that refresh / reopen on another browser
    // still hits the same session. 24h covers a typical workday; explicit
    // tab close still kills immediately via destroy().
    ptySoftCloseMs: 24 * 60 * 60 * 1000
  };
}

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a || !a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[a.slice(2)] = next;
        i++;
      } else {
        out[a.slice(2)] = true;
      }
    }
  }
  return out;
}
