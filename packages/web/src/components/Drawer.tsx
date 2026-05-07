import { useLayoutStore } from '../store/layout';
import { useResponsive } from '../hooks/useResponsive';
import { BookmarkPanel } from './BookmarkPanel';
import { HistoryPanel } from './HistoryPanel';
import { FileTree } from './FileTree';
import { SnippetPanel } from './SnippetPanel';
import { SettingsPanel } from './SettingsPanel';
import { NotificationToggle } from './NotificationToggle';

export function Drawer() {
  const responsive = useResponsive();
  const drawerOpen = useLayoutStore((s) => s.drawerOpen);
  const activePanel = useLayoutStore((s) => s.activePanel);
  const selectPanel = useLayoutStore((s) => s.selectPanel);

  const isMobile = responsive.device === 'mobile';

  return (
    <aside className={`drawer ${drawerOpen ? 'open' : 'closed'} ${isMobile ? 'mobile' : 'desktop'}`}>
      <header className="drawer-tabs">
        <button className={activePanel === 'bookmarks' ? 'on' : ''} onClick={() => selectPanel('bookmarks')}>★ 书签</button>
        <button className={activePanel === 'history' ? 'on' : ''} onClick={() => selectPanel('history')}>⏱ 历史</button>
        <button className={activePanel === 'files' ? 'on' : ''} onClick={() => selectPanel('files')}>📁 文件</button>
        <button className={activePanel === 'snippets' ? 'on' : ''} onClick={() => selectPanel('snippets')}>⌘ 片段</button>
        <button className={activePanel === 'settings' ? 'on' : ''} onClick={() => selectPanel('settings')}>⚙ 设置</button>
        <button className="drawer-close" aria-label="close" onClick={() => selectPanel(null)}>×</button>
      </header>
      <div className="drawer-body">
        {activePanel === 'bookmarks' && <BookmarkPanel />}
        {activePanel === 'history' && <HistoryPanel />}
        {activePanel === 'files' && <FileTree />}
        {activePanel === 'snippets' && <SnippetPanel />}
        {activePanel === 'settings' && <SettingsPanel />}
      </div>
      <footer className="drawer-footer">
        <NotificationToggle />
      </footer>
    </aside>
  );
}
