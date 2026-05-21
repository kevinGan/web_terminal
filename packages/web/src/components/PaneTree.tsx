import { useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { Pane, Tab } from '../store/tabs';
import { useTabsStore, countLeaves } from '../store/tabs';
import { isTouchPrimary } from '../hooks/useResponsive';
import { Terminal } from './Terminal';
import { DiffPane } from './DiffPane';
import { FilePreviewPane } from './FilePreviewPane';

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
  if (pane.type === 'diff') {
    return (
      <PaneDragWrapper pane={pane} tab={tab} isActive={isLeafActive}>
        <DiffPane key={pane.id} cwd={pane.cwd} file={pane.file} diffKind={pane.diffKind} />
      </PaneDragWrapper>
    );
  }
  if (pane.type === 'file-preview') {
    return (
      <PaneDragWrapper pane={pane} tab={tab} isActive={isLeafActive}>
        <FilePreviewPane
          key={pane.id}
          filePath={pane.filePath}
          fileName={pane.fileName}
          fileType={pane.fileType}
          cwd={pane.cwd}
        />
      </PaneDragWrapper>
    );
  }
  return (
    <PaneDragWrapper pane={pane} tab={tab} isActive={isLeafActive}>
      <Terminal
        key={pane.id}
        leafId={pane.id}
        initialSessionId={pane.sessionId}
        initialCwd={pane.cwd}
        isActive={isLeafActive}
        tabId={tab.id}
      />
    </PaneDragWrapper>
  );
}

function getLeafLabel(pane: Pane & { kind: 'leaf' }): string {
  if (pane.type === 'terminal') {
    if (pane.title) return pane.title;
    if (pane.cwd) return pane.cwd.split('/').pop() || pane.cwd;
    return 'shell';
  }
  if (pane.type === 'diff') return pane.file.split('/').pop() || pane.file;
  return pane.fileName;
}

/**
 * 包裹叶子 pane，实现子面板之间的拖拽交换。
 *
 * 关键设计：
 * - dragstart 时同步设置 document.body.classList.add('pane-dragging')
 *   配合 CSS `body.pane-dragging .pane-body > * { pointer-events: none }`
 *   让 xterm canvas 不再拦截 dragover/drop 事件，事件自然冒泡到 pane-drag-wrapper。
 * - 这是同步 DOM 操作，在 dragstart 事件的同一帧内生效，不依赖 React 渲染时机。
 * - dragend 时同步清除，恢复正常交互。
 * - 触屏设备不启用（HTML5 drag 不支持）。
 */
function PaneDragWrapper({
  pane,
  tab,
  isActive,
  children,
}: {
  pane: Pane & { kind: 'leaf' };
  tab: Tab;
  isActive: boolean;
  children: React.ReactNode;
}) {
  const swapPaneData = useTabsStore((s) => s.swapPaneData);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  if (isTouchPrimary()) return <>{children}</>;

  const multiLeaf = countLeaves(tab.root) > 1;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(
      'application/x-wt-leaf-data',
      JSON.stringify({ leafId: pane.id, tabId: tab.id })
    );
    setIsDragging(true);
    // 同步禁用所有 pane-body 直接子元素的 pointer-events，
    // 防止 xterm canvas 拦截后续 dragover/drop 事件。
    document.body.classList.add('pane-dragging');
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    document.body.classList.remove('pane-dragging');
  };

  const hasLeafMime = (types: ReadonlyArray<string>) =>
    types.includes('application/x-wt-leaf-data')
    || (types as unknown as { contains?: (s: string) => boolean }).contains?.('application/x-wt-leaf-data');

  const handleDragOver = (e: React.DragEvent) => {
    if (!hasLeafMime(e.dataTransfer.types)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains((e.nativeEvent as DragEvent).relatedTarget as Node)) return;
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    document.body.classList.remove('pane-dragging');
    const raw = e.dataTransfer.getData('application/x-wt-leaf-data');
    if (!raw) return;
    let src: { leafId: string; tabId: string };
    try { src = JSON.parse(raw); } catch { return; }
    if (src.leafId === pane.id || src.tabId !== tab.id) return;
    swapPaneData(tab.id, src.leafId, pane.id);
  };

  return (
    <div
      className={`pane-drag-wrapper ${isDragging ? 'is-dragging' : ''} ${isDragOver ? 'is-drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {multiLeaf && (
        <div
          className={`pane-subtab ${isActive ? 'is-active' : ''}`}
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => {
            if (!hasLeafMime(e.dataTransfer.types)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          title="拖拽交换面板位置"
        >
          <span className="pane-subtab-label">{getLeafLabel(pane)}</span>
        </div>
      )}
      <div className="pane-body">{children}</div>
    </div>
  );
}
