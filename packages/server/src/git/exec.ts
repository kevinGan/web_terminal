import { execFile } from 'node:child_process';

export interface GitResult {
  stdout: string;
  stderr: string;
  /**
   * - `>= 0`: actual exit status from git
   * - `-1`: spawn failure (git binary missing) or killed by signal/timeout
   */
  code: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;

export function runGit(
  cwd: string,
  args: string[],
  opts: { timeoutMs?: number; maxBuffer?: number } = {}
): Promise<GitResult> {
  const fullArgs = ['-C', cwd, ...args];
  return new Promise((resolveP) => {
    execFile(
      'git',
      fullArgs,
      {
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
        encoding: 'buffer'
      },
      (err, stdout, stderr) => {
        // Node's child_process callback puts the exit status in `err.code` as
        // a number when git exits non-zero, but uses string codes like 'ENOENT'
        // (binary missing) or 'ETIMEDOUT' for spawn/signal failures. Map those
        // to -1 so callers can distinguish "ran but returned 1" from "couldn't
        // even start". A null err means clean exit (code 0).
        const rawCode = (err as NodeJS.ErrnoException | null)?.code;
        const code = typeof rawCode === 'number' ? rawCode : err ? -1 : 0;
        resolveP({
          stdout: Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout ?? ''),
          stderr: Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr ?? ''),
          code
        });
      }
    );
  });
}
