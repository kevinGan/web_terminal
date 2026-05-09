import { useEffect, useMemo } from 'react';
import { TabBar } from './components/TabBar';
import { PaneTree } from './components/PaneTree';
import { Toolbar } from './components/Toolbar';
import { Drawer } from './components/Drawer';
import { useResponsive, isTouchPrimary } from './hooks/useResponsive';
import { useGestures } from './hooks/useGestures';
import { useTabsStore } from './store/tabs';
import { useNotifyStore } from './store/notifications';
import { bootstrapPersistence } from './store/persist';
import { getToken } from './api/token';
import { getActiveTerminalLeaf } from './store/active';
import { terminalRegistry } from './store/terminalRegistry';

export function App() {
  const responsive = useResponsive();
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const hydrated = useTabsStore((s) => s.hydrated);
  const selectTab = useTabsStore((s) => s.selectTab);
  // Effective active tab id (falls back to the first tab if the stored id is stale).
  const effActiveId = (tabs.find((t) => t.id === activeTabId) ?? tabs[0])?.id;

  // Trigger token capture once on mount (cleans URL) and start persistence.
  useEffect(() => {
    getToken();
    bootstrapPersistence();
  }, []);

  // Once tabs are hydrated, prune scrollback snapshots for leaves that no
  // longer exist (closed tabs/panes). Stops localStorage from growing
  // unbounded over time as the user creates and discards terminals.
  useEffect(() => {
    if (!hydrated) return;
    const liveLeafIds = new Set<string>();
    const collect = (p: { kind: string; id: string; a?: unknown; b?: unknown }) => {
      if (p.kind === 'leaf') liveLeafIds.add(p.id);
      else { collect(p.a as never); collect(p.b as never); }
    };
    tabs.forEach((t) => collect(t.root as never));
    const prefix = 'wt:scrollback:';
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const leafId = key.slice(prefix.length);
      if (!liveLeafIds.has(leafId)) localStorage.removeItem(key);
    }
    // One-shot prune at hydration; new entries are pruned on next reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Initialize Notification permission state (from current browser perm)
  const initNotify = useNotifyStore((s) => s.init);
  useEffect(() => { initNotify(); }, [initNotify]);

  // Mobile soft-keyboard discipline: iOS keeps the keyboard up for any tap
  // while the xterm textarea is `document.activeElement`, even one the user
  // already swiped down. Tapping a panel button, drawer item, or terminal
  // chrome would then "pop" the keyboard back. We blur on every pointerdown
  // outside of: an editable input the user is purposefully interacting with,
  // the xterm host (where direct typing belongs), and the dedicated ⌨ toggle.
  useEffect(() => {
    if (!isTouchPrimary()) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      // Direct interaction with text inputs / contenteditable: don't fight it.
      if (t.closest('input, textarea, [contenteditable="true"]')) return;
      // The xterm host owns the textarea — let xterm manage its own focus.
      if (t.closest('.xterm-host')) return;
      // The ⌨ toggle explicitly manages keyboard state.
      if (t.closest('.kbd-toggle')) return;
      const leaf = getActiveTerminalLeaf();
      if (leaf && terminalRegistry.isFocused(leaf.leaf.id)) {
        terminalRegistry.blur(leaf.leaf.id);
      }
    };
    // Capture phase so we run before the target's own handler — xterm/iOS
    // can't sneak a focus restore in between.
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const gestureHandlers = useMemo(() => ({
    onSwipeLeft: () => {
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      if (idx >= 0 && idx < tabs.length - 1) selectTab(tabs[idx + 1]!.id);
    },
    onSwipeRight: () => {
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      if (idx > 0) selectTab(tabs[idx - 1]!.id);
    }
  }), [tabs, activeTabId, selectTab]);
  useGestures(gestureHandlers);

  const layoutClass = `layout d-${responsive.device} o-${responsive.orientation}`;

  return (
    <div className={layoutClass}>
      <header className="topbar">
        <TabBar />
      </header>
      <main className="main">
        <Drawer />
        <section className="content">
          {!hydrated && <div className="hydrating">恢复工作区…</div>}
          {/*
            Render *all* tabs' PaneTrees, hiding inactive ones via CSS.
            Each PaneTree gets a stable `key={tab.id}` so React never reuses
            DOM/fiber across tabs (no xterm/WS/registry crosstalk), but staying
            mounted lets us avoid the reattach + snapshot replay round-trip
            when the user switches tabs.
          */}
          {hydrated && tabs.map((t) => (
            <div
              key={t.id}
              className="tab-host"
              data-active={t.id === effActiveId ? 'true' : 'false'}
            >
              <PaneTree tab={t} tabActive={t.id === effActiveId} />
            </div>
          ))}
        </section>
      </main>
      <Toolbar />
    </div>
  );
}
