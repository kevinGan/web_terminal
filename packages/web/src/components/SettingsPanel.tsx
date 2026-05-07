import { useEffect, useState } from 'react';
import { useClaudeCommandsStore } from '../store/claudeCommands';

export function SettingsPanel() {
  const list = useClaudeCommandsStore((s) => s.list);
  const loaded = useClaudeCommandsStore((s) => s.loaded);
  const load = useClaudeCommandsStore((s) => s.load);
  const add = useClaudeCommandsStore((s) => s.add);
  const update = useClaudeCommandsStore((s) => s.update);
  const remove = useClaudeCommandsStore((s) => s.remove);
  const reorder = useClaudeCommandsStore((s) => s.reorder);

  const [draftLabel, setDraftLabel] = useState('');
  const [draftCommand, setDraftCommand] = useState('');
  const [draftAuto, setDraftAuto] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editCommand, setEditCommand] = useState('');
  const [editAuto, setEditAuto] = useState(true);

  useEffect(() => { if (!loaded) load(); }, [loaded, load]);

  const onAdd = async () => {
    if (!draftCommand.trim()) return;
    await add(draftCommand.trim(), draftLabel.trim() || undefined, draftAuto);
    setDraftLabel('');
    setDraftCommand('');
    setDraftAuto(true);
  };

  const beginEdit = (id: string) => {
    const c = list.find((x) => x.id === id);
    if (!c) return;
    setEditingId(id);
    setEditLabel(c.label);
    setEditCommand(c.command);
    setEditAuto(c.autoSubmit ?? true);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await update(editingId, { label: editLabel, command: editCommand, autoSubmit: editAuto });
    setEditingId(null);
  };

  const move = async (id: string, dir: -1 | 1) => {
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    const ids = list.map((c) => c.id);
    const tmp = ids[idx]!;
    ids[idx] = ids[j]!;
    ids[j] = tmp;
    await reorder(ids);
  };

  return (
    <div className="panel settings-panel">
      <h3 className="panel-title">Claude 指令管理</h3>

      <div className="settings-add">
        <input
          className="search"
          placeholder="名称（显示用，可选）"
          value={draftLabel}
          onChange={(e) => setDraftLabel(e.target.value)}
        />
        <input
          className="search mono"
          placeholder="命令（如 /clear 或 commit and push）"
          value={draftCommand}
          onChange={(e) => setDraftCommand(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onAdd(); }}
        />
        <label className="checkbox-row">
          <input type="checkbox" checked={draftAuto} onChange={(e) => setDraftAuto(e.target.checked)} />
          <span>点击后自动按回车</span>
        </label>
        <button className="primary" onClick={onAdd} disabled={!draftCommand.trim()}>＋ 添加指令</button>
      </div>

      <ul className="settings-list">
        {list.length === 0 && <li className="empty">还没有指令。</li>}
        {list.map((c, idx) => (
          <li key={c.id} className="settings-item">
            {editingId === c.id ? (
              <div className="edit-form">
                <input
                  className="search"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  placeholder="名称"
                />
                <input
                  className="search mono"
                  value={editCommand}
                  onChange={(e) => setEditCommand(e.target.value)}
                  placeholder="命令"
                />
                <label className="checkbox-row">
                  <input type="checkbox" checked={editAuto} onChange={(e) => setEditAuto(e.target.checked)} />
                  <span>自动回车</span>
                </label>
                <div className="form-actions">
                  <button className="primary" onClick={saveEdit}>保存</button>
                  <button onClick={() => setEditingId(null)}>取消</button>
                </div>
              </div>
            ) : (
              <>
                <div className="settings-info">
                  <div className="label">{c.label}</div>
                  <div className="cmd"><code>{c.command}</code>{c.autoSubmit === false && <span className="hint"> (仅插入)</span>}</div>
                </div>
                <div className="settings-actions">
                  <button className="iconbtn small" title="上移" disabled={idx === 0} onClick={() => move(c.id, -1)}>↑</button>
                  <button className="iconbtn small" title="下移" disabled={idx === list.length - 1} onClick={() => move(c.id, 1)}>↓</button>
                  <button className="iconbtn small" title="编辑" onClick={() => beginEdit(c.id)}>✎</button>
                  <button className="iconbtn small danger" title="删除" onClick={() => { if (confirm(`删除 "${c.label}"？`)) remove(c.id); }}>×</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
