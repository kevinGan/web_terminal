import { create } from 'zustand';

export type Pane =
  | { kind: 'leaf'; id: string; type: 'terminal'; sessionId?: string; cwd?: string; title?: string; claudeMode?: boolean }
  | { kind: 'split'; id: string; dir: 'h' | 'v'; ratio: number; a: Pane; b: Pane };

export interface Tab {
  id: string;
  label: string;
  root: Pane;
  activeLeafId: string;
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string;
  /** True once the state has been hydrated from the server (or we know there's nothing to hydrate). */
  hydrated: boolean;
  newTab: () => void;
  closeTab: (id: string) => void;
  selectTab: (id: string) => void;
  renameTab: (id: string, label: string) => void;
  selectLeaf: (tabId: string, leafId: string) => void;
  splitActive: (dir: 'h' | 'v') => void;
  closeActiveLeaf: () => void;
  closeLeaf: (tabId: string, leafId: string) => void;
  setLeafSession: (leafId: string, sessionId: string) => void;
  setLeafCwd: (leafId: string, cwd: string) => void;
  setLeafTitle: (leafId: string, title: string) => void;
  setLeafClaudeMode: (leafId: string, claudeMode: boolean) => void;
  setSplitRatio: (splitId: string, ratio: number) => void;
  getActiveLeaf: () => Pane | null;
  hydrate: (snapshot: { tabs: Tab[]; activeTabId: string; idCounter: number }) => void;
}

let counter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`;
export function getIdCounter(): number { return counter; }
export function setIdCounter(n: number): void { counter = Math.max(counter, n); }

const initialTab = (): Tab => {
  const leafId = newId('leaf');
  return {
    id: newId('tab'),
    label: 'shell',
    root: { kind: 'leaf', id: leafId, type: 'terminal' },
    activeLeafId: leafId
  };
};

function findLeaf(pane: Pane, id: string): Pane | null {
  if (pane.kind === 'leaf') return pane.id === id ? pane : null;
  return findLeaf(pane.a, id) ?? findLeaf(pane.b, id);
}

function mapLeaf(pane: Pane, id: string, fn: (leaf: Pane) => Pane): Pane {
  if (pane.kind === 'leaf') return pane.id === id ? fn(pane) : pane;
  return { ...pane, a: mapLeaf(pane.a, id, fn), b: mapLeaf(pane.b, id, fn) };
}

function mapSplit(pane: Pane, id: string, fn: (split: Extract<Pane, { kind: 'split' }>) => Pane): Pane {
  if (pane.kind === 'leaf') return pane;
  if (pane.id === id) return fn(pane);
  return { ...pane, a: mapSplit(pane.a, id, fn), b: mapSplit(pane.b, id, fn) };
}

function removeLeaf(pane: Pane, id: string): Pane | null {
  if (pane.kind === 'leaf') return pane.id === id ? null : pane;
  const a = removeLeaf(pane.a, id);
  const b = removeLeaf(pane.b, id);
  if (a == null && b == null) return null;
  if (a == null) return b!;
  if (b == null) return a;
  return { ...pane, a, b };
}

function firstLeaf(pane: Pane): Pane {
  if (pane.kind === 'leaf') return pane;
  return firstLeaf(pane.a);
}

function findParentSplit(pane: Pane, leafId: string): Extract<Pane, { kind: 'split' }> | null {
  if (pane.kind === 'leaf') return null;
  if ((pane.a.kind === 'leaf' && pane.a.id === leafId) || (pane.b.kind === 'leaf' && pane.b.id === leafId)) {
    return pane;
  }
  return findParentSplit(pane.a, leafId) ?? findParentSplit(pane.b, leafId);
}

export function countLeaves(pane: Pane): number {
  if (pane.kind === 'leaf') return 1;
  return countLeaves(pane.a) + countLeaves(pane.b);
}

/**
 * Migrate any legacy `fileTree` pane from old state.json into a `terminal` pane.
 * Older builds let users swap a pane to a fileTree view; we removed that.
 * If the old data has a `prevTerminal` snapshot, reuse its sessionId/cwd so
 * the original PTY can still be reattached.
 */
function migrateLegacyPane(pane: unknown): Pane {
  if (!pane || typeof pane !== 'object') {
    // Defensive fallback — shouldn't normally happen.
    return { kind: 'leaf', id: `leaf_legacy_${Date.now().toString(36)}`, type: 'terminal' };
  }
  const p = pane as Record<string, unknown>;
  if (p.kind === 'split') {
    return {
      kind: 'split',
      id: String(p.id ?? `split_legacy_${Date.now().toString(36)}`),
      dir: (p.dir === 'v' ? 'v' : 'h'),
      ratio: typeof p.ratio === 'number' ? p.ratio : 0.5,
      a: migrateLegacyPane(p.a),
      b: migrateLegacyPane(p.b)
    };
  }
  // Leaf
  if (p.type === 'fileTree') {
    const prev = p.prevTerminal as Record<string, unknown> | undefined;
    return {
      kind: 'leaf',
      id: String(p.id),
      type: 'terminal',
      sessionId: prev?.sessionId as string | undefined,
      cwd: prev?.cwd as string | undefined,
      title: prev?.title as string | undefined,
      claudeMode: prev?.claudeMode as boolean | undefined
    };
  }
  // Terminal — pass through known fields.
  return {
    kind: 'leaf',
    id: String(p.id),
    type: 'terminal',
    sessionId: typeof p.sessionId === 'string' ? p.sessionId : undefined,
    cwd: typeof p.cwd === 'string' ? p.cwd : undefined,
    title: typeof p.title === 'string' ? p.title : undefined,
    claudeMode: typeof p.claudeMode === 'boolean' ? p.claudeMode : undefined
  };
}

/** Shared close-by-id helper used by both closeActiveLeaf and closeLeaf. */
function closeLeafIn(state: TabsState, tabId: string, leafId: string): Partial<TabsState> | TabsState {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab || !leafId) return state;
  const root = removeLeaf(tab.root, leafId);
  if (root == null) {
    // Last leaf — close the whole tab.
    const tabs = state.tabs.filter((t) => t.id !== tab.id);
    if (tabs.length === 0) {
      const t = initialTab();
      return { tabs: [t], activeTabId: t.id };
    }
    return {
      tabs,
      activeTabId: state.activeTabId === tab.id ? tabs[tabs.length - 1]!.id : state.activeTabId
    };
  }
  // Pick a new active leaf if we just removed it.
  const newActive = tab.activeLeafId === leafId ? firstLeaf(root).id : tab.activeLeafId;
  return {
    tabs: state.tabs.map((t) => (t.id === tab.id ? { ...t, root, activeLeafId: newActive } : t))
  };
}

export const useTabsStore = create<TabsState>((set, get) => ({
  // Start empty until hydration finishes; App shows a loader and won't mount
  // PaneTrees, avoiding a "create new shell, then immediately overwrite" flicker.
  tabs: [],
  activeTabId: '',
  hydrated: false,

  hydrate: (snapshot) => set(() => {
    setIdCounter(snapshot.idCounter || 0);
    if (snapshot.tabs.length === 0) {
      // No persisted tabs (first launch / cleared): seed with one fresh shell.
      const t = initialTab();
      return { tabs: [t], activeTabId: t.id, hydrated: true };
    }
    // Migrate each tab's pane tree, in case the persisted file has the old
    // `fileTree` pane variant (it was removed when the swap-to-fileTree
    // feature was retired).
    const migrated = snapshot.tabs.map((t) => ({
      ...t,
      root: migrateLegacyPane((t as { root: unknown }).root)
    }));
    const valid = migrated.find((t) => t.id === snapshot.activeTabId);
    return {
      tabs: migrated as Tab[],
      activeTabId: valid ? snapshot.activeTabId : migrated[0]!.id,
      hydrated: true
    };
  }),

  newTab: () => set((s) => {
    const tab = initialTab();
    return { tabs: [...s.tabs, tab], activeTabId: tab.id };
  }),

  closeTab: (id) => set((s) => {
    const tabs = s.tabs.filter((t) => t.id !== id);
    if (tabs.length === 0) {
      const t = initialTab();
      return { tabs: [t], activeTabId: t.id };
    }
    return {
      tabs,
      activeTabId: s.activeTabId === id ? tabs[tabs.length - 1]!.id : s.activeTabId
    };
  }),

  selectTab: (id) => set({ activeTabId: id }),

  renameTab: (id, label) => set((s) => ({
    tabs: s.tabs.map((t) => (t.id === id ? { ...t, label } : t))
  })),

  selectLeaf: (tabId, leafId) => set((s) => ({
    tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, activeLeafId: leafId } : t))
  })),

  splitActive: (dir) => set((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab) return s;
    const newLeafId = newId('leaf');
    const splitId = newId('split');
    const root = mapLeaf(tab.root, tab.activeLeafId, (leaf) => ({
      kind: 'split',
      id: splitId,
      dir,
      ratio: 0.5,
      a: leaf,
      b: { kind: 'leaf', id: newLeafId, type: 'terminal' }
    }));
    return {
      tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root, activeLeafId: newLeafId } : t))
    };
  }),

  closeActiveLeaf: () => set((s) => closeLeafIn(s, s.activeTabId, (() => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.activeLeafId ?? '';
  })())),

  closeLeaf: (tabId, leafId) => set((s) => closeLeafIn(s, tabId, leafId)),

  setLeafSession: (leafId, sessionId) => set((s) => ({
    tabs: s.tabs.map((t) => ({
      ...t,
      root: mapLeaf(t.root, leafId, (l) => (l.kind === 'leaf' && l.type === 'terminal' ? { ...l, sessionId } : l))
    }))
  })),

  setLeafCwd: (leafId, cwd) => set((s) => ({
    tabs: s.tabs.map((t) => ({
      ...t,
      root: mapLeaf(t.root, leafId, (l) => (l.kind === 'leaf' && l.type === 'terminal' ? { ...l, cwd } : l))
    }))
  })),

  setLeafTitle: (leafId, title) => set((s) => ({
    tabs: s.tabs.map((t) => ({
      ...t,
      root: mapLeaf(t.root, leafId, (l) => (l.kind === 'leaf' && l.type === 'terminal' ? { ...l, title } : l))
    }))
  })),

  setLeafClaudeMode: (leafId, claudeMode) => set((s) => {
    let changed = false;
    const tabs = s.tabs.map((t) => ({
      ...t,
      root: mapLeaf(t.root, leafId, (l) => {
        if (l.kind !== 'leaf' || l.type !== 'terminal') return l;
        if (l.claudeMode === claudeMode) return l;
        changed = true;
        return { ...l, claudeMode };
      })
    }));
    return changed ? { tabs } : s;
  }),

  setSplitRatio: (splitId, ratio) => set((s) => ({
    tabs: s.tabs.map((t) => ({
      ...t,
      root: mapSplit(t.root, splitId, (sp) => ({ ...sp, ratio }))
    }))
  })),

  getActiveLeaf: () => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab) return null;
    return findLeaf(tab.root, tab.activeLeafId);
  }
}));

// (Active tab id is set by hydrate() on app boot.)

export { findLeaf, findParentSplit };
