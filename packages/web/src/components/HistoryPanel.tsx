import { useEffect, useState } from 'react';
import { api, type CdHistoryEntry } from '../api/http';
import { cdActiveTerminal } from '../store/active';
import { useRemoteStore } from '../store/bookmarks';

export function HistoryPanel() {
  const [entries, setEntries] = useState<CdHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const pinPath = useRemoteStore((s) => s.pinPath);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    api.history.cd(80).then((r) => { if (!canceled) { setEntries(r.entries); setLoading(false); } })
      .catch(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, []);

  const filtered = filter
    ? entries.filter((e) => e.path.toLowerCase().includes(filter.toLowerCase()))
    : entries;

  return (
    <div className="panel history-panel">
      <div className="panel-actions">
        <input
          className="search"
          type="search"
          placeholder="搜索目录…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {loading && <div className="empty">加载中…</div>}
      {!loading && filtered.length === 0 && <div className="empty">没有历史 cd 记录。</div>}
      <ul className="history-list">
        {filtered.map((e) => (
          <li key={e.path} className="history-item">
            <button className="row" onClick={() => cdActiveTerminal(e.path)} title={e.path}>
              <span className="count">{e.count}×</span>
              <span className="path">{e.path}</span>
            </button>
            <button className="iconbtn small" title="加为书签" onClick={() => pinPath(e.path)}>📌</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
