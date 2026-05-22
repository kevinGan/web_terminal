import { create } from 'zustand';

export type DiffKind = 'staged' | 'unstaged' | 'untracked';

export type DropEdge = 'left' | 'right' | 'top' | 'bottom' | 'center';

export type Pane =
  | { kind: 'leaf'; id: string; type: 'terminal'; sessionId?: string; cwd?: string; title?: string; claudeMode?: boolean }
  | { kind: 'leaf'; id: string; type: 'diff'; cwd: string; file: string; diffKind: DiffKind; title?: string }
  | { kind: 'leaf'; id: string; type: 'file-preview'; filePath: string; fileName: string; fileType: 'md' | 'txt' | 'html'; cwd?: string; title?: string }
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
  /**
   * Reuse an existing diff tab if any (one is sufficient — clicking a different file
   * just retargets it). Otherwise append a new tab containing a single diff leaf.
   * In both cases the diff tab becomes the active tab.
   */
  openOrUpdateDiffTab: (cwd: string, file: string, diffKind: DiffKind) => void;
  openOrUpdateFilePreviewTab: (filePath: string, fileName: string, fileType: 'md' | 'txt' | 'html') => void;
  splitActiveWithFilePreview: (filePath: string, fileName: string, fileType: 'md' | 'txt' | 'html') => void;
  reorderTab: (fromIndex: number, toIndex: number) => void;
  swapPaneData: (tabId: string, leafIdA: string, leafIdB: string) => void;
  extractLeafToNewTab: (tabId: string, leafId: string) => void;
  /** 将 source tab 的整个 pane 树合并到 target tab 的 activeLeaf 位置，
   *  根据 edge 方向创建分屏。source tab 被移除。 */
  mergeTabAsSplit: (targetTabId: string, sourceTabId: string, edge: DropEdge) => void;
  /** 在 target tab 的 targetLeaf 位置，将 sourcePane 作为新子面板插入分屏。 */
  splitLeafWithPane: (targetTabId: string, targetLeafId: string, sourcePane: Pane, edge: DropEdge) => void;
  /** 同 tab 内将 sourceLeaf 移动到 targetLeaf 位置的分屏（先移除源，再 split 目标）。 */
  moveLeafToSplit: (tabId: string, sourceLeafId: string, targetLeafId: string, edge: DropEdge) => void;
  /** 跨 tab 将 sourceLeaf 移动到 targetLeaf 位置分屏（原子操作：单次 set()）。 */
  moveLeafCrossTab: (sourceTabId: string, sourceLeafId: string, targetTabId: string, targetLeafId: string, edge: DropEdge) => void;
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

/** First terminal leaf in a pane subtree, or null if none. */
export function firstTerminal(pane: Pane): Pane | null {
  if (pane.kind === 'leaf') return pane.type === 'terminal' ? pane : null;
  return firstTerminal(pane.a) ?? firstTerminal(pane.b);
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
  // Diff leaf — preserve as-is when restoring state.
  if (p.type === 'diff' && typeof p.cwd === 'string' && typeof p.file === 'string') {
    const dk = p.diffKind === 'staged' || p.diffKind === 'untracked' ? p.diffKind : 'unstaged';
    return {
      kind: 'leaf',
      id: String(p.id),
      type: 'diff',
      cwd: p.cwd,
      file: p.file,
      diffKind: dk,
      title: typeof p.title === 'string' ? p.title : undefined
    };
  }
  // File-preview leaf — preserve as-is when restoring state.
  if (p.type === 'file-preview' && typeof p.filePath === 'string' && typeof p.fileName === 'string') {
    const ft = p.fileType === 'md' || p.fileType === 'txt' || p.fileType === 'html' ? p.fileType : 'txt';
    return {
      kind: 'leaf',
      id: String(p.id),
      type: 'file-preview',
      filePath: p.filePath,
      fileName: p.fileName,
      fileType: ft,
      cwd: typeof p.cwd === 'string' ? p.cwd : undefined,
      title: typeof p.title === 'string' ? p.title : undefined
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
    const active = findLeaf(tab.root, tab.activeLeafId);
    // Diff tabs are conceptually single-pane: a split would orphan the diff
    // leaf from openOrUpdateDiffTab's "find existing" lookup (which only
    // matches when a diff leaf is the tab's root). No-op instead.
    if (active && active.kind === 'leaf' && (active.type === 'diff' || active.type === 'file-preview')) return s;
    // Inherit cwd from the active terminal leaf so the new shell starts in
    // the same dir.
    const inheritedCwd =
      active && active.kind === 'leaf' && active.type === 'terminal'
        ? active.cwd
        : undefined;
    const newLeafId = newId('leaf');
    const splitId = newId('split');
    const root = mapLeaf(tab.root, tab.activeLeafId, (leaf) => ({
      kind: 'split',
      id: splitId,
      dir,
      ratio: 0.5,
      a: leaf,
      b: { kind: 'leaf', id: newLeafId, type: 'terminal', cwd: inheritedCwd }
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
  },

  openOrUpdateDiffTab: (cwd, file, diffKind) => set((s) => {
    const label = diffTabLabel(file, diffKind);
    const existing = s.tabs.find((t) => t.root.kind === 'leaf' && t.root.type === 'diff');
    if (existing && existing.root.kind === 'leaf' && existing.root.type === 'diff') {
      const newRoot: Pane = { ...existing.root, cwd, file, diffKind };
      return {
        tabs: s.tabs.map((t) =>
          t.id === existing.id ? { ...t, label, root: newRoot, activeLeafId: newRoot.id } : t
        ),
        activeTabId: existing.id
      };
    }
    const leafId = newId('leaf');
    const tab: Tab = {
      id: newId('tab'),
      label,
      root: { kind: 'leaf', id: leafId, type: 'diff', cwd, file, diffKind },
      activeLeafId: leafId
    };
    return { tabs: [...s.tabs, tab], activeTabId: tab.id };
  }),

  openOrUpdateFilePreviewTab: (filePath, fileName, fileType) => set((s) => {
    const existing = s.tabs.find((t) => t.root.kind === 'leaf' && t.root.type === 'file-preview');
    if (existing && existing.root.kind === 'leaf' && existing.root.type === 'file-preview') {
      const newRoot: Pane = { ...existing.root, filePath, fileName, fileType };
      return {
        tabs: s.tabs.map((t) =>
          t.id === existing.id ? { ...t, label: fileName, root: newRoot, activeLeafId: newRoot.id } : t
        ),
        activeTabId: existing.id
      };
    }
    const leafId = newId('leaf');
    const tab: Tab = {
      id: newId('tab'),
      label: fileName,
      root: { kind: 'leaf', id: leafId, type: 'file-preview', filePath, fileName, fileType },
      activeLeafId: leafId
    };
    return { tabs: [...s.tabs, tab], activeTabId: tab.id };
  }),

  splitActiveWithFilePreview: (filePath, fileName, fileType) => set((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab) return s;
    const active = findLeaf(tab.root, tab.activeLeafId);
    if (!active || active.kind !== 'leaf' || active.type !== 'terminal') return s;
    const newLeafId = newId('leaf');
    const splitId = newId('split');
    const root = mapLeaf(tab.root, tab.activeLeafId, (leaf) => ({
      kind: 'split',
      id: splitId,
      dir: 'h',
      ratio: 0.5,
      a: leaf,
      b: { kind: 'leaf', id: newLeafId, type: 'file-preview', filePath, fileName, fileType }
    }));
    return {
      tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root, activeLeafId: newLeafId } : t))
    };
  }),

  /** Move tab at fromIndex to toIndex in the tabs array. No-op if same position. */
  reorderTab: (fromIndex, toIndex) => set((s) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return s;
    if (fromIndex >= s.tabs.length || toIndex >= s.tabs.length) return s;
    const tabs = [...s.tabs];
    const [moved] = tabs.splice(fromIndex, 1);
    if (moved) tabs.splice(toIndex, 0, moved);
    return { tabs };
  }),

  /** 在同一 tab 内交换两个叶子的元数据（type/sessionId/cwd/title 等），
   * 保留各自的 id 不变，因此 React key 不变，Terminal 组件实例不会重建，
   * PTY 连接和 xterm 画面完全保留。
   * split 节点在 pane 树中的位置（a/b 槽）同时交换，实现视觉上的位置互换。
   * activeLeafId 不变（id 没变，激活的格子还是同一个）。 */
  swapPaneData: (tabId, leafIdA, leafIdB) => set((s) => {
    const tab = s.tabs.find((t) => t.id === tabId);
    if (!tab) return s;
    const leafA = findLeaf(tab.root, leafIdA);
    const leafB = findLeaf(tab.root, leafIdB);
    if (!leafA || !leafB || leafA.kind !== 'leaf' || leafB.kind !== 'leaf') return s;
    if (leafA.id === leafB.id) return s;

    // 只交换 id 以外的所有字段，保持各自 id 不动。
    // 这样 React key 不变，xterm/PTY 实例完全保留，不会出现内容消失。
    // 视觉上的"位置互换"靠 pane-drag-wrapper 的 CSS order 或标签显示实现，
    // 实际上这里两个节点的 type/sessionId/cwd/title 互换后，subtab 标签会互换。
    const { id: _ia, ...dataA } = leafA as unknown as Record<string, unknown>;
    const { id: _ib, ...dataB } = leafB as unknown as Record<string, unknown>;
    const newLeafA = { ...dataB, id: leafA.id } as Pane;
    const newLeafB = { ...dataA, id: leafB.id } as Pane;

    let root = mapLeaf(tab.root, leafIdA, () => newLeafA);
    root = mapLeaf(root, leafIdB, () => newLeafB);

    // id 不变，activeLeafId 不需要改
    return {
      tabs: s.tabs.map((t) => t.id === tabId ? { ...t, root } : t)
    };
  }),

  /** Extract a leaf from its tab and move it into a brand-new tab. If the
   * source tab ends up empty the tab is closed. The new tab is appended and
   * becomes the active tab. No-op when the leaf is the only one in its tab. */
  extractLeafToNewTab: (tabId, leafId) => set((s) => {
    const tab = s.tabs.find((t) => t.id === tabId);
    if (!tab) return s;
    if (countLeaves(tab.root) <= 1) return s;
    const leaf = findLeaf(tab.root, leafId);
    if (!leaf || leaf.kind !== 'leaf') return s;

    const newRoot = removeLeaf(tab.root, leafId);
    const label = leaf.kind === 'leaf'
      ? leaf.type === 'terminal' ? (leaf.title || (leaf.cwd ? leaf.cwd.split('/').pop() || leaf.cwd : 'shell'))
      : leaf.type === 'diff' ? (leaf.file.split('/').pop() || leaf.file)
      : leaf.fileName
      : 'shell';
    const newTab: Tab = {
      id: newId('tab'),
      label,
      root: leaf,
      activeLeafId: leaf.id
    };

    if (newRoot == null) {
      const tabs = s.tabs.map((t) => t.id === tabId ? newTab : t);
      return { tabs, activeTabId: newTab.id };
    }

    const newActive = tab.activeLeafId === leafId ? firstLeaf(newRoot).id : tab.activeLeafId;
    const tabs = s.tabs.map((t) =>
      t.id === tabId ? { ...t, root: newRoot, activeLeafId: newActive } : t
    );
    return { tabs: [...tabs, newTab], activeTabId: newTab.id };
  }),

  /** 根据 edge 方向构造 split 节点：确定 dir 和 a/b 顺序。 */
  mergeTabAsSplit: (targetTabId, sourceTabId, edge) => set((s) => {
    if (targetTabId === sourceTabId) return s;
    const targetTab = s.tabs.find((t) => t.id === targetTabId);
    const sourceTab = s.tabs.find((t) => t.id === sourceTabId);
    if (!targetTab || !sourceTab) return s;

    // Guard: diff/file-preview singleton invariant — do not bury a singleton
    // leaf inside a split, as openOrUpdateDiffTab/openOrUpdateFilePreviewTab
    // look for `t.root.kind === 'leaf' && t.root.type === 'diff/file-preview'`.
    if (
      sourceTab.root.kind === 'leaf' &&
      (sourceTab.root.type === 'diff' || sourceTab.root.type === 'file-preview')
    ) return s;
    if (
      targetTab.root.kind === 'leaf' &&
      (targetTab.root.type === 'diff' || targetTab.root.type === 'file-preview')
    ) return s;

    const sourcePane = sourceTab.root;
    const dir = (edge === 'left' || edge === 'right') ? 'h' : 'v';
    const sourceFirst = (edge === 'left' || edge === 'top');
    const splitId = newId('split');
    const root = mapLeaf(targetTab.root, targetTab.activeLeafId, (leaf) => ({
      kind: 'split' as const,
      id: splitId,
      dir,
      ratio: 0.5,
      a: sourceFirst ? sourcePane : leaf,
      b: sourceFirst ? leaf : sourcePane,
    }));

    const tabs = s.tabs.filter((t) => t.id !== sourceTabId);
    return {
      tabs: tabs.map((t) => t.id === targetTabId
        ? { ...t, root, activeLeafId: firstLeaf(sourcePane).id }
        : t
      ),
      // Fix: if the dragged-away tab was the active tab, switch to target
      activeTabId: s.activeTabId === sourceTabId ? targetTabId : s.activeTabId,
    };
  }),

  /** 在 targetLeaf 位置插入 sourcePane 形成分屏。 */
  splitLeafWithPane: (targetTabId, targetLeafId, sourcePane, edge) => set((s) => {
    const tab = s.tabs.find((t) => t.id === targetTabId);
    if (!tab) return s;
    if (!findLeaf(tab.root, targetLeafId)) return s;
    // Guard: do not bury diff/file-preview singleton leaf in a split
    if (sourcePane.kind === 'leaf' && (sourcePane.type === 'diff' || sourcePane.type === 'file-preview')) return s;

    const dir = (edge === 'left' || edge === 'right') ? 'h' : 'v';
    const sourceFirst = (edge === 'left' || edge === 'top');
    const splitId = newId('split');
    const root = mapLeaf(tab.root, targetLeafId, (leaf) => ({
      kind: 'split' as const,
      id: splitId,
      dir,
      ratio: 0.5,
      a: sourceFirst ? sourcePane : leaf,
      b: sourceFirst ? leaf : sourcePane,
    }));

    return {
      tabs: s.tabs.map((t) => t.id === targetTabId
        ? { ...t, root, activeLeafId: firstLeaf(sourcePane).id }
        : t
      ),
    };
  }),

  /** 同 tab 内：将 sourceLeafId 从树中移除，在 targetLeafId 位置创建分屏。 */
  moveLeafToSplit: (tabId, sourceLeafId, targetLeafId, edge) => set((s) => {
    const tab = s.tabs.find((t) => t.id === tabId);
    if (!tab) return s;
    if (sourceLeafId === targetLeafId) return s;
    const sourceLeaf = findLeaf(tab.root, sourceLeafId);
    if (!sourceLeaf) return s;

    // 先移除 source leaf
    const rootAfterRemove = removeLeaf(tab.root, sourceLeafId);
    if (!rootAfterRemove) return s; // 不应发生（至少还有 targetLeaf）

    // targetLeafId 可能因移除而改变了位置，但 id 不变，仍然可以 mapLeaf
    if (!findLeaf(rootAfterRemove, targetLeafId)) return s;

    const dir = (edge === 'left' || edge === 'right') ? 'h' : 'v';
    const sourceFirst = (edge === 'left' || edge === 'top');
    const splitId = newId('split');
    const root = mapLeaf(rootAfterRemove, targetLeafId, (leaf) => ({
      kind: 'split' as const,
      id: splitId,
      dir,
      ratio: 0.5,
      a: sourceFirst ? sourceLeaf : leaf,
      b: sourceFirst ? leaf : sourceLeaf,
    }));

    return {
      tabs: s.tabs.map((t) => t.id === tabId
        ? { ...t, root, activeLeafId: firstLeaf(sourceLeaf).id }
        : t
      ),
    };
  }),

  /** 跨 tab 将 sourceLeaf 从 sourceTab 移动到 targetTab 的 targetLeaf 位置分屏。
   *  原子操作：单次 set() 完成"提取 + 分屏"，避免两次 set() 的中间状态。
   *  Guard: diff/file-preview singleton leaf 不允许跨 tab 迁移分屏。 */
  moveLeafCrossTab: (sourceTabId, sourceLeafId, targetTabId, targetLeafId, edge) => set((s) => {
    if (sourceTabId === targetTabId) return s;
    const sourceTab = s.tabs.find((t) => t.id === sourceTabId);
    const targetTab = s.tabs.find((t) => t.id === targetTabId);
    if (!sourceTab || !targetTab) return s;

    const sourceLeaf = findLeaf(sourceTab.root, sourceLeafId);
    if (!sourceLeaf || sourceLeaf.kind !== 'leaf') return s;
    // Guard: diff/file-preview singleton leaf must not be moved into a split
    if (sourceLeaf.type === 'diff' || sourceLeaf.type === 'file-preview') return s;

    if (!findLeaf(targetTab.root, targetLeafId)) return s;

    // Remove source leaf from source tab
    const newSourceRoot = removeLeaf(sourceTab.root, sourceLeafId);
    const dir = (edge === 'left' || edge === 'right') ? 'h' : 'v';
    const sourceFirst = (edge === 'left' || edge === 'top');
    const splitId = newId('split');
    const newTargetRoot = mapLeaf(targetTab.root, targetLeafId, (leaf) => ({
      kind: 'split' as const,
      id: splitId,
      dir,
      ratio: 0.5,
      a: sourceFirst ? sourceLeaf : leaf,
      b: sourceFirst ? leaf : sourceLeaf,
    }));

    const tabs = s.tabs.flatMap((t) => {
      if (t.id === sourceTabId) {
        if (newSourceRoot == null) return []; // source tab is now empty — remove it
        const newActive = t.activeLeafId === sourceLeafId ? firstLeaf(newSourceRoot).id : t.activeLeafId;
        return [{ ...t, root: newSourceRoot, activeLeafId: newActive }];
      }
      if (t.id === targetTabId) {
        return [{ ...t, root: newTargetRoot, activeLeafId: firstLeaf(sourceLeaf).id }];
      }
      return [t];
    });

    // If source tab was removed and it was the active tab, fall back to target tab
    const stillHasSource = tabs.some((t) => t.id === sourceTabId);
    const activeTabId =
      !stillHasSource && s.activeTabId === sourceTabId ? targetTabId : s.activeTabId;

    return { tabs, activeTabId };
  }),
}));

function diffTabLabel(file: string, kind: DiffKind): string {
  const base = file.split('/').pop() || file;
  const tag = kind === 'staged' ? '●' : kind === 'untracked' ? '+' : '~';
  return `${tag} ${base}`;
}

// (Active tab id is set by hydrate() on app boot.)

export { findLeaf, findParentSplit };
