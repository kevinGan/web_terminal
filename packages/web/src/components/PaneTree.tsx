import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { Pane, Tab } from '../store/tabs';
import { useTabsStore } from '../store/tabs';
import { Terminal } from './Terminal';

interface Props { tab: Tab; tabActive: boolean; }

export function PaneTree({ tab, tabActive }: Props) {
  return (
    <div className="pane-tree" data-tab-id={tab.id}>
      <PaneNode key={tab.root.id} pane={tab.root} tab={tab} tabActive={tabActive} />
    </div>
  );
}

function PaneNode({ pane, tab, tabActive }: { pane: Pane; tab: Tab; tabActive: boolean }) {
  const setSplitRatio = useTabsStore((s) => s.setSplitRatio);
  if (pane.kind === 'split') {
    const direction = pane.dir === 'h' ? 'horizontal' : 'vertical';
    return (
      <PanelGroup
        direction={direction}
        onLayout={(sizes) => {
          if (sizes.length === 2 && Number.isFinite(sizes[0]!)) {
            setSplitRatio(pane.id, sizes[0]! / 100);
          }
        }}
      >
        <Panel defaultSize={pane.ratio * 100} minSize={10}>
          <PaneNode key={pane.a.id} pane={pane.a} tab={tab} tabActive={tabActive} />
        </Panel>
        <PanelResizeHandle className={`resize-handle ${direction}`} />
        <Panel defaultSize={(1 - pane.ratio) * 100} minSize={10}>
          <PaneNode key={pane.b.id} pane={pane.b} tab={tab} tabActive={tabActive} />
        </Panel>
      </PanelGroup>
    );
  }
  // Only the currently visible tab's active leaf is "the focused pane".
  const isLeafActive = tabActive && tab.activeLeafId === pane.id;
  // The only kind of leaf left is `terminal` — the legacy fileTree leaf was retired.
  return (
    <Terminal
      key={pane.id}
      leafId={pane.id}
      initialSessionId={pane.sessionId}
      initialCwd={pane.cwd}
      isActive={isLeafActive}
      tabId={tab.id}
    />
  );
}
