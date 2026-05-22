import { useState, useRef } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { Pane, Tab, DropEdge } from '../store/tabs';
import { useTabsStore, countLeaves, findLeaf } from '../store/tabs';
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

/** 根据鼠标相对于矩形的位置判断靠近哪个边缘，用于分屏 drop 方向。 */
function detectEdge(rect: DOMRect, clientX: number, clientY: number): DropEdge | null {
  const relX = (clientX - rect.left) / rect.width;
  const relY = (clientY - rect.top) / rect.height;
  const T = 0.3;
  const dLeft = relX, dRight = 1 - relX, dTop = relY, dBottom = 1 - relY;
  const minD = Math.min(dLeft, dRight, dTop, dBottom);
  if (minD > T) return 'center';
  if (dLeft === minD) return 'left';
  if (dRight === minD) return 'right';
  if (dTop === minD) return 'top';
  return 'bottom';
}

const hasLeafMime = (types: ReadonlyArray<string>) =>
  types.includes('application/x-wt-leaf-data')
  || (types as unknown as { contains?: (s: string) => boolean }).contains?.('application/x-wt-leaf-data');

const hasTabMime = (types: ReadonlyArray<string>) =>
  types.includes('application/x-wt-tab-id')
  || (types as unknown as { contains?: (s: string) => boolean }).contains?.('application/x-wt-tab-id');

/**
 * 包裹叶子 pane，实现子面板之间的拖拽交换和分屏。
 *
 * 关键设计：
 * - dragstart 时同步设置 document.body.classList.add('pane-dragging')
 *   配合 CSS `body.pane-dragging .pane-body > * { pointer-events: none }`
 *   让 xterm canvas 不再拦截 dragover/drop 事件，事件自然冒泡到 pane-drag-wrapper。
 * - 这是同步 DOM 操作，在 dragstart 事件的同一帧内生效，不依赖 React 渲染时机。
 * - dragend 时同步清除，恢复正常交互。
 * - 触屏设备不启用（HTML5 drag 不支持）。
 * - 支持 Tab 拖入分屏：从 TabBar 拖 Tab 到面板边缘 → mergeTabAsSplit
 * - 支持 subtab 拖入分屏：拖 subtab 到另一面板边缘 → splitLeafWithPane / moveLeafToSplit
 * - 中心区域 → 互换（同 tab）或忽略（跨 tab / Tab 来源）
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
  const mergeTabAsSplit = useTabsStore((s) => s.mergeTabAsSplit);
  const moveLeafToSplit = useTabsStore((s) => s.moveLeafToSplit);
  const moveLeafCrossTab = useTabsStore((s) => s.moveLeafCrossTab);
  const [isDragging, setIsDragging] = useState(false);
  const [dropEdge, setDropEdge] = useState<DropEdge | null>(null);
  // Ref tracks the latest edge so handleDrop is never stale (Issue #3)
  const dropEdgeRef = useRef<DropEdge | null>(null);

  if (isTouchPrimary()) return <>{children}</>;

  const multiLeaf = countLeaves(tab.root) > 1;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(
      'application/x-wt-leaf-data',
      JSON.stringify({ leafId: pane.id, tabId: tab.id })
    );
    setIsDragging(true);
    document.body.classList.add('pane-dragging');
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    document.body.classList.remove('pane-dragging');
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!hasLeafMime(e.dataTransfer.types) && !hasTabMime(e.dataTransfer.types)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const edge = detectEdge(rect, e.clientX, e.clientY);
    dropEdgeRef.current = edge;
    setDropEdge(edge);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains((e.nativeEvent as DragEvent).relatedTarget as Node)) return;
    dropEdgeRef.current = null;
    setDropEdge(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    // Re-compute edge from event position to avoid stale closure (Issue #3)
    const rect = e.currentTarget.getBoundingClientRect();
    const edge = detectEdge(rect, e.clientX, e.clientY) ?? dropEdgeRef.current;
    dropEdgeRef.current = null;
    setDropEdge(null);
    document.body.classList.remove('pane-dragging');

    // 来源 1: Tab drag → 边缘分屏，中心忽略
    const tabIdRaw = e.dataTransfer.getData('application/x-wt-tab-id');
    if (tabIdRaw) {
      if (tabIdRaw === tab.id) return; // 拖到自己的 pane，忽略
      if (!edge || edge === 'center') return; // 中心区域不做操作
      mergeTabAsSplit(tab.id, tabIdRaw, edge);
      return;
    }

    // 来源 2: Pane subtab drag → 中心=互换，边缘=分屏
    const raw = e.dataTransfer.getData('application/x-wt-leaf-data');
    if (!raw) return;
    let src: { leafId: string; tabId: string };
    try { src = JSON.parse(raw); } catch { return; }
    if (src.leafId === pane.id) return;

    if (!edge || edge === 'center') {
      // 中心区域：互换（仅同 tab）
      if (src.tabId !== tab.id) return;
      swapPaneData(tab.id, src.leafId, pane.id);
      return;
    }

    // 边缘分屏
    if (src.tabId !== tab.id) {
      // 跨 tab：原子操作 moveLeafCrossTab（Issue #2 fix）
      moveLeafCrossTab(src.tabId, src.leafId, tab.id, pane.id, edge);
    } else {
      // 同 tab 内：移动 leaf 到目标处形成分屏
      moveLeafToSplit(tab.id, src.leafId, pane.id, edge);
    }
  };

  return (
    <div
      className={`pane-drag-wrapper ${isDragging ? 'is-dragging' : ''} ${dropEdge ? 'is-drag-over' : ''}`}
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
            if (!hasLeafMime(e.dataTransfer.types) && !hasTabMime(e.dataTransfer.types)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          title="拖拽交换面板位置或拖到边缘分屏"
        >
          <span className="pane-subtab-label">{getLeafLabel(pane)}</span>
        </div>
      )}
      <div className="pane-body">
        {children}
        {dropEdge && dropEdge !== 'center' && (
          <div className={`drop-zone-overlay ${dropEdge}`} />
        )}
        {dropEdge === 'center' && (
          <div className="drop-zone-overlay center" />
        )}
      </div>
    </div>
  );
}
