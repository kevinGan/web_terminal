import { useCallback, useEffect, useRef, useState } from 'react';
import { useTabsStore, findLeaf, firstTerminal } from '../store/tabs';
import { gitApi, type ChangeEntry, type ChangeKind, type GitStatusResponse } from '../api/git';

type Selection = { kind: ChangeKind; path: string } | null;

export function GitPanel() {
  // cwd selector: prefer the active terminal leaf's cwd; fall back to the active
  // diff leaf's cwd so the panel stays coherent while a diff tab is focused.
  const cwd = useTabsStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab) return null;
    const active = findLeaf(tab.root, tab.activeLeafId);
    if (active && active.kind === 'leaf') {
      if (active.type === 'terminal' && active.cwd) return active.cwd;
      if (active.type === 'diff') return active.cwd;
    }
    const term = firstTerminal(tab.root);
    return term && term.kind === 'leaf' && term.type === 'terminal' ? term.cwd ?? null : null;
  });

  const openDiff = useTabsStore((s) => s.openOrUpdateDiffTab);

  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection>(null);

  const fetchSeq = useRef(0);

  const refreshStatus = useCallback(async () => {
    if (!cwd) return;
    const mySeq = ++fetchSeq.current;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const s = await gitApi.status(cwd);
      if (fetchSeq.current !== mySeq) return;
      setStatus(s);
      setSelected((prev) => (prev && pickFromStatus(s, prev.kind, prev.path) ? prev : null));
    } catch (e) {
      if (fetchSeq.current !== mySeq) return;
      setStatusError(formatErr(e));
    } finally {
      if (fetchSeq.current === mySeq) setStatusLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setStatus(null);
    setSelected(null);
    if (cwd) refreshStatus();
  }, [cwd, refreshStatus]);

  const onSelect = useCallback(
    (sel: Selection) => {
      setSelected(sel);
      if (sel && cwd) openDiff(cwd, sel.path, sel.kind);
    },
    [cwd, openDiff]
  );

  if (!cwd) {
    return <div className="git-panel-empty">无活跃终端 — 请先打开一个终端</div>;
  }

  return (
    <div className="git-panel">
      <header className="git-panel-header">
        <div className="git-panel-title">
          {status?.isRepo ? (
            <>
              <span className="git-branch">⎇ {status.branch ?? '(detached)'}</span>
              {status.head && <span className="git-head">@{status.head}</span>}
            </>
          ) : (
            <span className="git-branch git-branch-none">非 git 仓库</span>
          )}
        </div>
        <button
          className="git-refresh"
          onClick={refreshStatus}
          disabled={statusLoading}
          title="刷新"
          aria-label="refresh"
        >
          {statusLoading ? '…' : '⟳'}
        </button>
      </header>

      <div className="git-cwd" title={cwd}>{cwd}</div>

      {statusError && <div className="git-status-error">{statusError}</div>}

      {status?.isRepo === false && !statusError && (
        <div className="git-panel-empty">当前目录不在任何 git 仓库内</div>
      )}

      {status?.isRepo && (
        <ChangeList status={status} selected={selected} onSelect={onSelect} />
      )}
    </div>
  );
}

interface ListProps {
  status: GitStatusResponse;
  selected: Selection;
  onSelect: (s: Selection) => void;
}

function ChangeList({ status, selected, onSelect }: ListProps) {
  const total = status.staged.length + status.unstaged.length + status.untracked.length;
  if (total === 0) {
    return <div className="git-panel-empty">No changes — 工作区干净</div>;
  }
  return (
    <div className="git-changes git-changes-full">
      <ChangeGroup title="Staged" kind="staged" entries={status.staged} selected={selected} onSelect={onSelect} />
      <ChangeGroup title="Unstaged" kind="unstaged" entries={status.unstaged} selected={selected} onSelect={onSelect} />
      <ChangeGroup title="Untracked" kind="untracked" entries={status.untracked} selected={selected} onSelect={onSelect} />
    </div>
  );
}

interface GroupProps {
  title: string;
  kind: ChangeKind;
  entries: ChangeEntry[];
  selected: Selection;
  onSelect: (s: Selection) => void;
}

function ChangeGroup({ title, kind, entries, selected, onSelect }: GroupProps) {
  if (entries.length === 0) return null;
  return (
    <section className="git-group">
      <h4 className="git-group-title">
        {title} <span className="git-group-count">({entries.length})</span>
      </h4>
      <ul className="git-group-list">
        {entries.map((e) => {
          const isSel = selected?.kind === kind && selected.path === e.path;
          return (
            <li key={`${kind}:${e.path}`}>
              <button
                className={`git-row${isSel ? ' selected' : ''}`}
                onClick={() => onSelect({ kind, path: e.path })}
                title={e.oldPath ? `${e.oldPath} → ${e.path}` : e.path}
              >
                <span className={`git-status git-status-${e.status}`}>{statusGlyph(e.status)}</span>
                <span className="git-path">{e.path}</span>
                <span className="git-numstat">
                  {typeof e.adds === 'number' && e.adds > 0 && <span className="git-adds">+{e.adds}</span>}
                  {typeof e.dels === 'number' && e.dels > 0 && <span className="git-dels">-{e.dels}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function statusGlyph(s: ChangeEntry['status']): string {
  switch (s) {
    case 'M': return '●';
    case 'A': return '+';
    case 'D': return '−';
    case 'R': return '→';
    case 'C': return '⎘';
    case 'T': return '◐';
    case 'U': return '!';
    case '?': return '+';
  }
}

function pickFromStatus(s: GitStatusResponse, kind: ChangeKind, path: string): ChangeEntry | null {
  const list = kind === 'staged' ? s.staged : kind === 'unstaged' ? s.unstaged : s.untracked;
  return list.find((e) => e.path === path) ?? null;
}

function formatErr(e: unknown): string {
  if (e && typeof e === 'object' && 'status' in e) {
    const status = (e as { status: number }).status;
    const body = (e as { body?: unknown }).body;
    const msg = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : '';
    return `请求失败 (HTTP ${status})${msg ? `: ${msg}` : ''}`;
  }
  return e instanceof Error ? e.message : String(e);
}
