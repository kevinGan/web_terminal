import { create } from 'zustand';

type PermState = 'default' | 'granted' | 'denied' | 'unsupported';

interface NotifyState {
  perm: PermState;
  enabled: boolean;
  /** Initialize from current browser permission. Idempotent. */
  init: () => void;
  /** Ask for permission via user gesture. Updates `perm`. */
  request: () => Promise<PermState>;
  /** User toggle: only fire when both perm=granted and enabled=true. */
  setEnabled: (v: boolean) => void;
  /**
   * Fire a notification if permission granted, page not visible, and enabled.
   * Returns true if a notification was actually shown.
   */
  notify: (title: string, body?: string, opts?: { tag?: string; onClick?: () => void; force?: boolean }) => boolean;
}

const STORAGE_KEY = 'wt_notify_enabled';

function readStoredEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const v = localStorage.getItem(STORAGE_KEY);
  return v == null ? true : v === '1';
}

function writeStoredEnabled(v: boolean) {
  try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch {}
}

export const useNotifyStore = create<NotifyState>((set, get) => ({
  perm: 'default',
  enabled: readStoredEnabled(),

  init: () => {
    if (typeof Notification === 'undefined') {
      set({ perm: 'unsupported' });
      return;
    }
    set({ perm: Notification.permission as PermState });
  },

  request: async () => {
    if (typeof Notification === 'undefined') {
      set({ perm: 'unsupported' });
      return 'unsupported';
    }
    try {
      const res = await Notification.requestPermission();
      set({ perm: res as PermState });
      return res as PermState;
    } catch {
      return 'denied';
    }
  },

  setEnabled: (v) => {
    writeStoredEnabled(v);
    set({ enabled: v });
  },

  notify: (title, body, opts) => {
    const { perm, enabled } = get();
    if (perm !== 'granted' || !enabled) return false;
    const force = opts?.force ?? false;
    if (!force && typeof document !== 'undefined' && !document.hidden) return false;
    try {
      const n = new Notification(title, {
        body,
        tag: opts?.tag,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        silent: false
      });
      if (opts?.onClick) {
        n.onclick = (ev) => {
          ev.preventDefault();
          window.focus();
          opts.onClick?.();
          n.close();
        };
      }
      return true;
    } catch {
      return false;
    }
  }
}));
