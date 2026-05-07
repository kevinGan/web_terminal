import { useEffect } from 'react';
import { runInActiveTerminal, typeInActiveTerminal } from '../store/active';

export interface CmdItem {
  id: string;
  label: string;
  command: string;
  /** True (default) → runs the command; false → only types it (user can edit). */
  autoSubmit?: boolean;
}

interface Props {
  title: string;
  items: CmdItem[];
  empty?: string;
  onClose: () => void;
  /** Optional ⚙ button in the header (e.g. "manage commands"). */
  onManage?: () => void;
}

/**
 * Stateless bottom-sheet picker. Renders a list of slash commands; a tap
 * either runs (autoSubmit) or just types (user can append args first).
 * Press Esc or tap backdrop to close.
 */
export function CommandPicker({ title, items, empty, onClose, onManage }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onPick = (cmd: CmdItem) => {
    if (cmd.autoSubmit !== false) runInActiveTerminal(cmd.command);
    else typeInActiveTerminal(cmd.command);
    onClose();
  };

  return (
    <div
      className="cmd-picker-backdrop"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="cmd-picker" role="dialog" aria-label={title}>
        <header className="cmd-picker-head">
          <span>{title}</span>
          {onManage && (
            <button className="iconbtn small" title="管理" onClick={onManage}>⚙</button>
          )}
          <button className="iconbtn small" onClick={onClose} aria-label="close">×</button>
        </header>
        <ul className="cmd-picker-list">
          {items.length === 0 && <li className="empty">{empty ?? '没有可用项。'}</li>}
          {items.map((c) => (
            <li key={c.id}>
              <button className="row" onPointerDown={() => onPick(c)} title={c.command}>
                <span className="label">{c.label}</span>
                {c.label !== c.command && <span className="cmd">{c.command}</span>}
                {c.autoSubmit === false && <span className="hint">(仅插入)</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
