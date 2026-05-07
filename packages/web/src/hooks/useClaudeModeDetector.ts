import { useEffect, useRef } from 'react';

const STRIP_ANSI_RE = /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-z]|\x1b[=>]|\x1b\([AB012]/g;

const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Heuristic: Claude Code paints a rounded box around the input area using
 * `╭`, `╮`, `╰`, `╯`, `─`, `│` and uses `❯ ` as the prompt cursor. If the
 * trailing window contains those markers we're "inside Claude Code".
 *
 * Required signals (in trailing 4 KB of stripped output):
 *   - `╭`  AND  `╰`   (top + bottom of the input frame)
 *   - `❯`            (Claude's input cursor)
 * Hysteresis: requires N consecutive feed events on the same side before
 * flipping, to avoid flicker on splash screens.
 */
export interface UseClaudeModeOpts {
  enabled: boolean;
  windowBytes?: number;
  /** Idle ms after the last chunk before re-evaluating mode. */
  idleMs?: number;
  onChange: (inClaude: boolean) => void;
}

export function useClaudeModeDetector(opts: UseClaudeModeOpts): { feed: (chunk: Uint8Array) => void } {
  const enabled = opts.enabled;
  const windowBytes = opts.windowBytes ?? 4096;
  const idleMs = opts.idleMs ?? 200;

  const buf = useRef<string>('');
  const current = useRef<boolean | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef(opts.onChange);
  cb.current = opts.onChange;

  useEffect(() => () => {
    buf.current = '';
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  const evaluate = () => {
    const cleaned = buf.current.replace(STRIP_ANSI_RE, '');
    const tail = cleaned.slice(-windowBytes);
    const hasTop = tail.indexOf('╭') !== -1;
    const hasBot = tail.indexOf('╰') !== -1;
    const hasCursor = tail.indexOf('❯') !== -1;
    const inClaude = hasTop && hasBot && hasCursor;
    if (current.current === inClaude) return;
    current.current = inClaude;
    cb.current(inClaude);
  };

  return {
    feed(chunk: Uint8Array) {
      if (!enabled) return;
      // Cheap accumulate; expensive evaluation deferred to idle.
      const text = decoder.decode(chunk, { stream: true });
      buf.current = (buf.current + text).slice(-windowBytes * 2);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(evaluate, idleMs);
    }
  };
}
