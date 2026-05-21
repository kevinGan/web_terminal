import { useEffect, useRef, useState } from 'react';
import { useTabsStore } from '../store/tabs';
import { useLayoutStore } from '../store/layout';
import { useResponsive, isTouchPrimary } from '../hooks/useResponsive';

export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const selectTab = useTabsStore((s) => s.selectTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const newTab = useTabsStore((s) => s.newTab);
  const renameTab = useTabsStore((s) => s.renameTab);
  const splitActive = useTabsStore((s) => s.splitActive);
  const closeActiveLeaf = useTabsStore((s) => s.closeActiveLeaf);
  const reorderTab = useTabsStore((s) => s.reorderTab);
  const extractLeafToNewTab = useTabsStore((s) => s.extractLeafToNewTab);
  const toggleDrawer = useLayoutStore((s) => s.toggleDrawer);
  const responsive = useResponsive();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmingCloseId, setConfirmingCloseId] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drag-and-drop state
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isPaneDragOver, setIsPaneDragOver] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchPrimary = isTouchPrimary();

  const armClose = (id: string) => {
    if (confirmingCloseId === id) {
      // Second click within window — actually close.
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
      setConfirmingCloseId(null);
      closeTab(id);
      return;
    }
    setConfirmingCloseId(id);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => {
      setConfirmingCloseId(null);
      confirmTimer.current = null;
    }, 3000);
  };

  useEffect(() => {
    if (!confirmingCloseId) return;
    // Delay listener registration past the click that armed it so we don't
    // immediately swallow our own event in the bubble/capture phase.
    let attached = false;
    const onDocClick = (e: MouseEvent | TouchEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && tgt.closest('.tab-close')) return;
      setConfirmingCloseId(null);
      if (confirmTimer.current) { clearTimeout(confirmTimer.current); confirmTimer.current = null; }
    };
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDocClick as EventListener, true);
      document.addEventListener('touchstart', onDocClick as EventListener, true);
      attached = true;
    }, 50);
    return () => {
      clearTimeout(t);
      if (attached) {
        document.removeEventListener('mousedown', onDocClick as EventListener, true);
        document.removeEventListener('touchstart', onDocClick as EventListener, true);
      }
    };
  }, [confirmingCloseId]);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  // Cmd+D (horizontal) / Cmd+Shift+D (vertical) split shortcuts (macOS only).
  // We deliberately do NOT fire on `ctrlKey`: Ctrl+D is the standard EOF binding
  // in Linux/Windows terminals, and clobbering it breaks shells, REPLs, etc.
  // Capture phase so we beat xterm's keydown handler and the browser's
  // bookmark binding. `e.code` is layout-independent (Shift makes `e.key === 'D'`).
  // Skipped while editing a tab label so the input keeps native behavior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyD') return;
      if (!e.metaKey) return;
      if (e.altKey || e.ctrlKey) return;
      if (editingId) return;
      e.preventDefault();
      e.stopPropagation();
      splitActive(e.shiftKey ? 'v' : 'h');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [splitActive, editingId]);

  const beginEdit = (id: string, label: string) => {
    setEditingId(id);
    setDraft(label);
  };

  const commitEdit = () => {
    if (editingId) {
      const trimmed = draft.trim();
      if (trimmed) renameTab(editingId, trimmed);
    }
    setEditingId(null);
    setDraft('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft('');
  };

  // --- Drag-and-drop handlers ---

  const handleTabDragStart = (e: React.DragEvent, tabId: string) => {
    if (touchPrimary) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-wt-tab-id', tabId);
    setDraggingTabId(tabId);
  };

  const handleTabDragEnd = () => {
    setDraggingTabId(null);
    setDragOverIndex(null);
    setIsPaneDragOver(false);
  };

  const isTabDrag = (types: ReadonlyArray<string>) =>
    types.includes('application/x-wt-tab-id')
    || (types as unknown as { contains?: (s: string) => boolean }).contains?.('application/x-wt-tab-id');
  const isPaneDrag = (types: ReadonlyArray<string>) =>
    types.includes('application/x-wt-leaf-data')
    || (types as unknown as { contains?: (s: string) => boolean }).contains?.('application/x-wt-leaf-data');

  const handleScrollDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const types = e.dataTransfer.types;
    if (isTabDrag(types)) {
      e.dataTransfer.dropEffect = 'move';
      const scrollEl = scrollRef.current;
      if (!scrollEl) return;
      const tabButtons = scrollEl.querySelectorAll<HTMLElement>('.tab');
      const mouseX = e.clientX;

      let insertIndex = tabs.length;
      for (let i = 0; i < tabButtons.length; i++) {
        const rect = tabButtons[i]!.getBoundingClientRect();
        if (mouseX < rect.left + rect.width / 2) {
          insertIndex = i;
          break;
        }
      }
      setDragOverIndex(insertIndex);

      const scrollRect = scrollEl.getBoundingClientRect();
      const edge = 30;
      if (mouseX < scrollRect.left + edge) {
        scrollEl.scrollBy({ left: -8, behavior: 'auto' });
      } else if (mouseX > scrollRect.right - edge) {
        scrollEl.scrollBy({ left: 8, behavior: 'auto' });
      }
      return;
    }
    if (isPaneDrag(types)) {
      e.dataTransfer.dropEffect = 'move';
      setIsPaneDragOver(true);
      return;
    }
  };

  const handleScrollDragLeave = () => {
    setDragOverIndex(null);
    setIsPaneDragOver(false);
  };

  const handleScrollDrop = (e: React.DragEvent) => {
    e.preventDefault();

    // Pane drop → extract leaf into a new tab
    const raw = e.dataTransfer.getData('application/x-wt-leaf-data');
    if (raw) {
      let src: { leafId: string; tabId: string };
      try { src = JSON.parse(raw); } catch { return; }
      setDraggingTabId(null);
      setDragOverIndex(null);
      setIsPaneDragOver(false);
      extractLeafToNewTab(src.tabId, src.leafId);
      return;
    }

    // Tab drop → reorder
    const tabId = e.dataTransfer.getData('application/x-wt-tab-id');
    setDraggingTabId(null);
    setDragOverIndex(null);
    if (!tabId) return;
    const fromIndex = tabs.findIndex((t) => t.id === tabId);
    if (fromIndex === -1) return;
    const dropIdx = dragOverIndex ?? tabs.length;
    if (dropIdx === null || fromIndex === dropIdx) return;
    const adjustedTo = dropIdx > fromIndex ? dropIdx - 1 : dropIdx;
    if (adjustedTo === fromIndex) return;
    reorderTab(fromIndex, adjustedTo);
  };

  return (
    <div className={`tabbar ${isPaneDragOver ? 'pane-drop-target' : ''}`}>
      <button
        className="iconbtn drawer-toggle"
        title="侧边栏"
        onClick={toggleDrawer}
        aria-label="toggle sidebar"
      >☰</button>
      <div
        className="tabs-scroll"
        ref={scrollRef}
        onDragOver={handleScrollDragOver}
        onDragLeave={handleScrollDragLeave}
        onDrop={handleScrollDrop}
      >
        {tabs.map((t, idx) => {
          const isEditing = editingId === t.id;
          const dropBefore = !touchPrimary && dragOverIndex === idx && draggingTabId !== t.id;
          return (
            <button
              key={t.id}
              className={`tab ${t.id === activeTabId ? 'is-active' : ''} ${isEditing ? 'is-editing' : ''} ${draggingTabId === t.id ? 'is-dragging' : ''} ${dropBefore ? 'drop-before' : ''}`}
              draggable={!touchPrimary && !isEditing}
              onClick={() => { if (!isEditing) selectTab(t.id); }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (t.id !== activeTabId) selectTab(t.id);
                beginEdit(t.id, t.label);
              }}
              onDragStart={(e) => handleTabDragStart(e, t.id)}
              onDragEnd={handleTabDragEnd}
              title={isEditing ? '回车保存 · Esc 取消' : `${t.label} (双击改名)`}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  className="tab-edit"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commitEdit();
                    else if (e.key === 'Escape') cancelEdit();
                  }}
                  onBlur={commitEdit}
                  onClick={(e) => e.stopPropagation()}
                  spellCheck={false}
                  maxLength={32}
                />
              ) : (
                <span className="tab-label">{t.label}</span>
              )}
              {!isEditing && (
                <span
                  className={`tab-close ${confirmingCloseId === t.id ? 'confirm' : ''}`}
                  role="button"
                  aria-label={confirmingCloseId === t.id ? '再次点击确认关闭' : 'close'}
                  title={confirmingCloseId === t.id ? '再次点击确认关闭' : '关闭'}
                  onClick={(e) => { e.stopPropagation(); armClose(t.id); }}
                >{confirmingCloseId === t.id ? '?' : '×'}</span>
              )}
            </button>
          );
        })}
        <button className="tab-new iconbtn" onClick={() => newTab()} title="新建终端">+</button>
      </div>
      {responsive.device !== 'mobile' && (
        <div className="tab-actions">
          <button className="iconbtn" onClick={() => splitActive('h')} title="水平分屏 (左右) — ⌘D">⇆</button>
          <button className="iconbtn" onClick={() => splitActive('v')} title="垂直分屏 (上下) — ⇧⌘D">⇅</button>
          <button className="iconbtn" onClick={() => closeActiveLeaf()} title="关闭当前面板">✕</button>
        </div>
      )}
    </div>
  );
}
