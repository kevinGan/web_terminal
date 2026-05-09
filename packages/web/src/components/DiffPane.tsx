import { useEffect, useState } from 'react';
import { PatchDiff } from '@pierre/diffs/react';
// Side-effect: registers the custom element used by PatchDiff.
// The path is aliased in vite.config.ts because `@pierre/diffs` doesn't
// list this file in its package `exports`.
import '@pierre/diffs/web-components';
import { gitApi, type ChangeKind, type GitDiffResponse } from '../api/git';

// Threshold above which we hand syntax highlighting off to a worker pool.
// Below it, the spin-up cost dwarfs the highlight time so main thread wins.
const WORKER_PATCH_THRESHOLD = 200 * 1024;

interface Props {
  cwd: string;
  file: string;
  diffKind: ChangeKind;
}

export function DiffPane({ cwd, file, diffKind }: Props) {
  const [diff, setDiff] = useState<GitDiffResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setDiff(null);
    gitApi
      .diff(cwd, file, diffKind)
      .then((d) => {
        if (!cancelled) setDiff(d);
      })
      .catch((e) => {
        if (!cancelled) setErr(formatErr(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, file, diffKind]);

  return (
    <div className="diff-pane">
      <header className="diff-pane-header">
        <span className={`diff-pane-kind diff-pane-kind-${diffKind}`}>{kindLabel(diffKind)}</span>
        <span className="diff-pane-path" title={file}>{file}</span>
        <span className="diff-pane-cwd" title={cwd}>{shortCwd(cwd)}</span>
      </header>
      <div className="diff-pane-body">
        {loading && <div className="diff-pane-empty">加载中…</div>}
        {err && <div className="diff-pane-empty diff-pane-error">{err}</div>}
        {!loading && !err && diff && diff.binary && (
          <div className="diff-pane-empty">二进制文件，diff 已省略</div>
        )}
        {!loading && !err && diff && !diff.binary && !diff.patch && (
          <div className="diff-pane-empty">无变更内容</div>
        )}
        {!loading && !err && diff && !diff.binary && diff.patch && (
          <>
            {diff.truncated && (
              <div className="diff-pane-truncated">
                diff 超过 1MB，已截断 — 请在终端用 git diff 查看完整内容
              </div>
            )}
            <PatchDiff
              patch={diff.patch}
              disableWorkerPool={diff.patch.length < WORKER_PATCH_THRESHOLD}
            />
          </>
        )}
      </div>
    </div>
  );
}

function kindLabel(k: ChangeKind): string {
  return k === 'staged' ? 'STAGED' : k === 'untracked' ? 'NEW' : 'UNSTAGED';
}

function shortCwd(p: string): string {
  const parts = p.split('/').filter(Boolean);
  if (parts.length <= 3) return p;
  return '…/' + parts.slice(-2).join('/');
}

function formatErr(e: unknown): string {
  if (e && typeof e === 'object' && 'status' in e) {
    const status = (e as { status: number }).status;
    const body = (e as { body?: unknown }).body;
    const msg =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : '';
    return `请求失败 (HTTP ${status})${msg ? `: ${msg}` : ''}`;
  }
  return e instanceof Error ? e.message : String(e);
}
