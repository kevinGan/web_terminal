import { useEffect, useMemo } from 'react';
import { TabBar } from './components/TabBar';
import { PaneTree } from './components/PaneTree';
import { Toolbar } from './components/Toolbar';
import { Drawer } from './components/Drawer';
import { useResponsive } from './hooks/useResponsive';
import { useGestures } from './hooks/useGestures';
import { useTabsStore } from './store/tabs';
import { useNotifyStore } from './store/notifications';
import { bootstrapPersistence } from './store/persist';
import { getToken } from './api/token';

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

  // Initialize Notification permission state (from current browser perm)
  const initNotify = useNotifyStore((s) => s.init);
  useEffect(() => { initNotify(); }, [initNotify]);

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
