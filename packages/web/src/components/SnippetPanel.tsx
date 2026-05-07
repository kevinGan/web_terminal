import { useEffect, useState } from 'react';
import { useRemoteStore } from '../store/bookmarks';
import { runInActiveTerminal, typeInActiveTerminal } from '../store/active';

export function SnippetPanel() {
  const snippets = useRemoteStore((s) => s.snippets);
  const loaded = useRemoteStore((s) => s.loaded);
  const loadAll = useRemoteStore((s) => s.loadAll);
  const addSnippet = useRemoteStore((s) => s.addSnippet);
  const removeSnippet = useRemoteStore((s) => s.removeSnippet);

  const [label, setLabel] = useState('');
  const [command, setCommand] = useState('');

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);

  const onAdd = async () => {
    if (!command.trim()) return;
    await addSnippet(command.trim(), label.trim() || undefined);
    setLabel(''); setCommand('');
  };

  return (
    <div className="panel snippet-panel">
      <div className="panel-actions add-snippet">
        <input
          className="search"
          placeholder="名称（可选）"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className="search"
          placeholder="命令"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onAdd(); }}
        />
        <button className="primary" onClick={onAdd}>＋</button>
      </div>
      <ul className="snippet-list">
        {snippets.map((s) => (
          <li key={s.id} className="snippet-item">
            <button className="row" onClick={() => runInActiveTerminal(s.command)} title={s.command}>
              <span className="label">{s.label}</span>
              <span className="cmd">{s.command}</span>
            </button>
            <button
              className="iconbtn small"
              title="只插入命令（不回车）"
              onClick={() => typeInActiveTerminal(s.command)}
            >↩︎</button>
            <button className="iconbtn small" title="删除" onClick={() => removeSnippet(s.id)}>×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
