import { useEffect, useRef } from 'react';

/**
 * Watches a stream of PTY chunks for "user input expected" patterns and fires
 * a callback when:
 *   1) A trigger pattern appears in recent (post-strip) output, AND
 *   2) The stream has been idle for `idleMs` after the last write.
 *
 * The detection is conservative: we look at the trailing N bytes (default 4 KB)
 * with ANSI escape sequences stripped, so prompts like
 *   `Enter to confirm · Esc to cancel`
 *   `Press Enter to continue`
 *   `Do you want to ...? (y/N)`
 *   `❯ ` (Claude Code's user input cursor)
 * are detected reliably.
 *
 * Each fire is throttled by `cooldownMs` to avoid spamming notifications when
 * Claude reprints the same prompt frame.
 */

const STRIP_ANSI_RE = /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-z]|\x1b[=>]|\x1b\([AB012]/g;

const TRIGGERS: { name: string; re: RegExp }[] = [
  { name: 'enter-confirm', re: /Enter to confirm|press\s+enter|press\s+\[?enter\]?/i },
  { name: 'continue', re: /(press\s+\w+\s+to\s+continue)/i },
  { name: 'yes-no', re: /\(y\/n\)|\[y\/n\]|\(yes\/no\)|\?\s*\(?y(es)?\/n(o)?\)?/i },
  { name: 'choose', re: /^\s*\d+\.\s.+$\s*[\r\n]+\s*\d+\.\s.+/m },
  { name: 'claude-prompt', re: /❯\s*$/ },
  { name: 'select-prompt', re: /(?:^|\n)\s*[›>]\s*\d+\.\s/m }
];

export interface PromptDetectedEvent {
  trigger: string;
  /** Last ~200 chars of clean output for context (to use as notification body). */
  preview: string;
}

export interface UsePromptDetectorOptions {
  enabled: boolean;
  idleMs?: number;
  cooldownMs?: number;
  windowBytes?: number;
  onPromptDetected: (ev: PromptDetectedEvent) => void;
}

export function usePromptDetector(opts: UsePromptDetectorOptions): { feed: (chunk: Uint8Array) => void } {
  const { enabled, onPromptDetected } = opts;
  const idleMs = opts.idleMs ?? 800;
  const cooldownMs = opts.cooldownMs ?? 8_000;
  const windowBytes = opts.windowBytes ?? 4096;

  const bufferRef = useRef<string>('');
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFireAt = useRef(0);
  const cbRef = useRef(onPromptDetected);
  cbRef.current = onPromptDetected;

  useEffect(() => {
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  const evaluate = () => {
    const buf = bufferRef.current;
    if (!buf) return;
    const cleaned = buf.replace(STRIP_ANSI_RE, '');
    const tail = cleaned.slice(-windowBytes);
    for (const t of TRIGGERS) {
      if (t.re.test(tail)) {
        const now = Date.now();
        if (now - lastFireAt.current < cooldownMs) return;
        lastFireAt.current = now;
        const preview = tail.split('\n').filter((l) => l.trim()).slice(-3).join(' · ').slice(-180);
        cbRef.current({ trigger: t.name, preview });
        return;
      }
    }
  };

  return {
    feed(chunk: Uint8Array) {
      if (!enabled) return;
      const text = decoder.decode(chunk, { stream: true });
      bufferRef.current = (bufferRef.current + text).slice(-windowBytes * 2);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(evaluate, idleMs);
    }
  };
}

const decoder = new TextDecoder('utf-8', { fatal: false });
