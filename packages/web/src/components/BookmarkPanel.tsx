import { useEffect } from 'react';
import { useRemoteStore } from '../store/bookmarks';
import { activeCwd, cdActiveTerminal } from '../store/active';

export function BookmarkPanel() {
  const bookmarks = useRemoteStore((s) => s.bookmarks);
  const pinPath = useRemoteStore((s) => s.pinPath);
  const remove = useRemoteStore((s) => s.removeBookmark);
  const loaded = useRemoteStore((s) => s.loaded);
  const loadAll = useRemoteStore((s) => s.loadAll);

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);

  const onPin = async () => {
    const cwd = activeCwd();
    if (!cwd) return;
    await pinPath(cwd);
  };

  return (
    <div className="panel bookmark-panel">
      <div className="panel-actions">
        <button className="primary" onClick={onPin} title="将当前活跃终端的目录加为书签">📌 Pin 当前目录</button>
      </div>
      <ul className="bookmarks">
        {bookmarks.length === 0 && <li className="empty">暂无书签 — 切换到一个目录后点 Pin。</li>}
        {bookmarks.map((b) => (
          <li key={b.id} className="bookmark-item">
            <button className="row" onClick={() => cdActiveTerminal(b.path)} title={b.path}>
              <span className="label">{b.label}</span>
              <span className="path">{b.path}</span>
            </button>
            <button className="iconbtn small" title="删除" onClick={() => remove(b.id)}>×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
