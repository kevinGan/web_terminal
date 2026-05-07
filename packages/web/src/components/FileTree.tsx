import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type FileEntry } from '../api/http';
import { activeCwd, cdActiveTerminal, runInActiveTerminal } from '../store/active';
import { useRemoteStore } from '../store/bookmarks';
import { isTouchPrimary } from '../hooks/useResponsive';

interface Props { rootPath?: string }

/** Drop focus from any active editable element so the soft keyboard hides. */
function dismissKeyboard() {
  const el = document.activeElement;
  if (el && 'blur' in el && typeof (el as HTMLElement).blur === 'function') {
    (el as HTMLElement).blur();
  }
}

type PinFeedback = 'idle' | 'pinning' | 'pinned' | 'duplicate' | 'error';

export function FileTree({ rootPath }: Props = {}) {
  const [path, setPath] = useState<string>(rootPath ?? '');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [parent, setParent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingPath, setEditingPath] = useState(false);
  const [pinState, setPinState] = useState<PinFeedback>('idle');
  const pinResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchPrimary = isTouchPrimary();
  const pinPath = useRemoteStore((s) => s.pinPath);
  const bookmarks = useRemoteStore((s) => s.bookmarks);

  const onPin = async () => {
    if (!path) return;
    if (pinResetTimer.current) clearTimeout(pinResetTimer.current);
    if (bookmarks.some((b) => b.path === path)) {
      setPinState('duplicate');
    } else {
      setPinState('pinning');
      try {
        await pinPath(path);
        setPinState('pinned');
      } catch {
        setPinState('error');
      }
    }
    pinResetTimer.current = setTimeout(() => setPinState('idle'), 1500);
  };

  useEffect(() => () => {
    if (pinResetTimer.current) clearTimeout(pinResetTimer.current);
  }, []);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.files.list(p, showHidden);
      setPath(r.path);
      setParent(r.parent);
      setEntries(r.entries);
    } catch (e) {
      setError((e as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [showHidden]);

  // Sync to active terminal cwd if user clicks "Sync"
  const syncFromTerminal = () => {
    const cwd = activeCwd();
    if (cwd) load(cwd);
  };

  useEffect(() => {
    const init = path || rootPath || activeCwd() || '';
    load(init || '~');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden]);

  const pinLabel = pinState === 'pinned' ? '✓' : pinState === 'duplicate' ? '✓' : pinState === 'error' ? '⚠' : '📌';
  const pinTitle =
    pinState === 'pinned' ? '已加入书签' :
    pinState === 'duplicate' ? '已存在书签里' :
    pinState === 'error' ? '加书签失败' :
    '加为书签';

  return (
    <div className="panel file-tree">
      <div className="file-actions-row file-actions-row-1">
        <button className="iconbtn" title="返回上级" onClick={() => parent && load(parent)}>↑</button>
        <input
          className="search path-input"
          value={path}
          readOnly={touchPrimary && !editingPath}
          inputMode={touchPrimary && !editingPath ? 'none' : undefined}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { load(path); setEditingPath(false); (e.target as HTMLElement).blur(); } }}
          onBlur={() => setEditingPath(false)}
        />
        {touchPrimary && (
          <button
            className={`iconbtn ${editingPath ? 'on' : ''}`}
            title={editingPath ? '完成编辑' : '编辑路径'}
            onClick={() => setEditingPath((v) => !v)}
          >✎</button>
        )}
      </div>
      <div className="file-actions-row file-actions-row-2">
        <button className="iconbtn" title="刷新" onClick={() => load(path)}>↻</button>
        <button className="iconbtn" title="同步到当前终端目录" onClick={syncFromTerminal}>⇲</button>
        <button
          className={`iconbtn ${showHidden ? 'on' : ''}`}
          title="显示隐藏文件"
          onClick={() => setShowHidden((v) => !v)}
        >.</button>
        <button
          className={`iconbtn pin-btn pin-${pinState}`}
          title={pinTitle}
          onClick={onPin}
          disabled={pinState === 'pinning'}
          aria-live="polite"
        >{pinLabel}</button>
        <button className="iconbtn cd-btn" title="cd 到此" onClick={() => cdActiveTerminal(path)}>→ cd</button>
      </div>
      {error && <div className="error">{error}</div>}
      {loading && <div className="empty">加载中…</div>}
      <ul
        className="file-list"
        onTouchStart={touchPrimary ? dismissKeyboard : undefined}
      >
        {entries.map((e) => (
          <li key={e.path} className={`file-item type-${e.type}`}>
            <button
              className="row"
              onPointerDown={touchPrimary ? dismissKeyboard : undefined}
              onDoubleClick={() => {
                if (e.type === 'dir') load(e.path);
              }}
              onClick={() => {
                if (e.type === 'dir') {
                  cdActiveTerminal(e.path);
                  load(e.path);
                } else if (e.type === 'file') {
                  // open in $EDITOR (best-effort)
                  const escaped = e.path.replace(/'/g, "'\\''");
                  runInActiveTerminal(`\${EDITOR:-vi} '${escaped}'`);
                }
              }}
              title={e.path}
            >
              <span className="icon">{e.type === 'dir' ? '📁' : e.type === 'symlink' ? '🔗' : '📄'}</span>
              <span className="name">{e.name}</span>
              {typeof e.size === 'number' && <span className="size">{formatSize(e.size)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n}`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}M`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)}G`;
}
