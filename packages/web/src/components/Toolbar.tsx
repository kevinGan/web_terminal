import { useResponsive } from '../hooks/useResponsive';
import { useTabsStore } from '../store/tabs';
import { useLayoutStore } from '../store/layout';
import { useRemoteStore } from '../store/bookmarks';
import { activeCwd, runInActiveTerminal } from '../store/active';
import { VirtualKeys } from './VirtualKeys';
import { useEffect } from 'react';

export function Toolbar() {
  const responsive = useResponsive();
  const splitActive = useTabsStore((s) => s.splitActive);
  const closeActiveLeaf = useTabsStore((s) => s.closeActiveLeaf);
  const selectPanel = useLayoutStore((s) => s.selectPanel);
  const activePanel = useLayoutStore((s) => s.activePanel);
  const drawerOpen = useLayoutStore((s) => s.drawerOpen);
  const pinPath = useRemoteStore((s) => s.pinPath);
  const loaded = useRemoteStore((s) => s.loaded);
  const loadAll = useRemoteStore((s) => s.loadAll);

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);

  const isMobilePortrait = responsive.device === 'mobile' && responsive.orientation === 'portrait';
  if (!isMobilePortrait) return null;

  const onPin = async () => {
    const cwd = activeCwd();
    if (!cwd) return;
    await pinPath(cwd);
  };

  const togglePanel = (p: typeof activePanel) => {
    if (drawerOpen && activePanel === p) selectPanel(null);
    else selectPanel(p);
  };

  return (
    <aside className="toolbar pos-bottom" aria-label="toolbar">
      <VirtualKeys />
      <div className="toolbar-actions">
        <button className={`tbtn ${activePanel === 'bookmarks' && drawerOpen ? 'on' : ''}`} onClick={() => togglePanel('bookmarks')} title="书签">★</button>
        <button className={`tbtn ${activePanel === 'history' && drawerOpen ? 'on' : ''}`} onClick={() => togglePanel('history')} title="历史 cd">⏱</button>
        <button className={`tbtn ${activePanel === 'files' && drawerOpen ? 'on' : ''}`} onClick={() => togglePanel('files')} title="文件浏览">📁</button>
        <button className={`tbtn ${activePanel === 'snippets' && drawerOpen ? 'on' : ''}`} onClick={() => togglePanel('snippets')} title="命令片段">⌘</button>
        <button className={`tbtn ${activePanel === 'settings' && drawerOpen ? 'on' : ''}`} onClick={() => togglePanel('settings')} title="设置">⚙</button>
        <span className="sep" />
        <button className="tbtn" onClick={() => splitActive('h')} title="水平分屏">⇄</button>
        <button className="tbtn" onClick={() => splitActive('v')} title="垂直分屏">⇵</button>
        <button className="tbtn" onClick={() => closeActiveLeaf()} title="关闭面板">×</button>
        <span className="sep" />
        <button className="tbtn pin" onClick={onPin} title="Pin 当前目录">📌</button>
      </div>
    </aside>
  );
}

// Re-export for App layout decisions if needed
export function commandFromSnippet(cmd: string) { runInActiveTerminal(cmd); }
