import { useEffect, useState, useCallback } from 'react';
import { useGlobalSettingsStore } from '../store/globalSettings';
import { settingsApi, type TokenInfo, type ConnectionInfo } from '../api/settings';
import { setStoredToken } from '../api/token';

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'success'; text: string };

function maskToken(tok: string): string {
  if (!tok) return '';
  if (tok.length <= 12) return '•'.repeat(tok.length);
  return `${tok.slice(0, 6)}${'•'.repeat(Math.min(tok.length - 10, 24))}${tok.slice(-4)}`;
}

export function GlobalSettingsModal() {
  const open = useGlobalSettingsStore((s) => s.open);
  const close = useGlobalSettingsStore((s) => s.closeModal);

  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [conn, setConn] = useState<ConnectionInfo | null>(null);
  const [reveal, setReveal] = useState(false);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [qrNonce, setQrNonce] = useState(0);

  // Load data when the modal opens; reset transient state when it closes.
  useEffect(() => {
    if (!open) {
      setReveal(false);
      setDraft('');
      setStatus({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    setStatus({ kind: 'busy', text: '加载中…' });
    Promise.all([settingsApi.getToken(), settingsApi.getConnection()])
      .then(([tok, c]) => {
        if (cancelled) return;
        setTokenInfo(tok);
        setConn(c);
        setStatus({ kind: 'idle' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus({ kind: 'error', text: `加载失败：${(err as Error).message}` });
      });
    return () => { cancelled = true; };
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const applyNewToken = useCallback((next: string) => {
    setStoredToken(next);
    setStatus({ kind: 'success', text: 'Token 已更新，正在刷新页面…' });
    // Short delay so the user sees the message; reload re-establishes
    // every WS/REST call with the new token cleanly.
    setTimeout(() => window.location.reload(), 800);
  }, []);

  const onSave = useCallback(async () => {
    const next = draft.trim();
    if (!next) return;
    setStatus({ kind: 'busy', text: '保存中…' });
    try {
      const res = await settingsApi.setToken(next);
      applyNewToken(res.token);
    } catch (err) {
      setStatus({ kind: 'error', text: `保存失败：${(err as Error).message}` });
    }
  }, [draft, applyNewToken]);

  const onRotate = useCallback(async () => {
    if (!confirm('确定要生成新的随机 Token 吗？所有旧 Token 立即失效。')) return;
    setStatus({ kind: 'busy', text: '生成中…' });
    try {
      const res = await settingsApi.rotateToken();
      applyNewToken(res.token);
    } catch (err) {
      setStatus({ kind: 'error', text: `生成失败：${(err as Error).message}` });
    }
  }, [applyNewToken]);

  const onCopy = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus({ kind: 'success', text: `${label}已复制` });
      setTimeout(() => setStatus((s) => (s.kind === 'success' && s.text === `${label}已复制` ? { kind: 'idle' } : s)), 1500);
    } catch {
      setStatus({ kind: 'error', text: '复制失败，请手动选择' });
    }
  }, []);

  if (!open) return null;

  const tok = tokenInfo?.token ?? '';
  const authEnabled = tokenInfo?.enabled ?? false;
  const qrSrc = tok ? `/qr?token=${encodeURIComponent(tok)}&format=png&_=${qrNonce}` : '';

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="panel-title">全局设置</h3>
          <button className="iconbtn modal-close" title="关闭 (Esc)" onClick={close}>×</button>
        </div>

        {status.kind !== 'idle' && (
          <div className={`modal-status ${status.kind}`}>{status.text}</div>
        )}

        {!authEnabled && tokenInfo && (
          <div className="modal-section">
            <div className="modal-section-title">鉴权状态</div>
            <p className="hint">当前服务器以 <code>--no-token</code> 启动，鉴权已禁用。需要管理 Token 请重启服务器恢复鉴权。</p>
          </div>
        )}

        {authEnabled && (
          <>
            <div className="modal-section">
              <div className="modal-section-title">当前 Token</div>
              <div className="token-row">
                <code className="token-display mono">{reveal ? tok : maskToken(tok)}</code>
                <button className="iconbtn small" title={reveal ? '隐藏' : '显示'} onClick={() => setReveal((v) => !v)}>
                  {reveal ? '🙈' : '👁'}
                </button>
                <button className="iconbtn small" title="复制" onClick={() => onCopy(tok, 'Token')} disabled={!tok}>📋</button>
              </div>
            </div>

            <div className="modal-section">
              <div className="modal-section-title">设置自定义 Token</div>
              <div className="token-row">
                <input
                  className="search mono"
                  placeholder="任意非空字符串，例如 my-laptop-2026"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onSave(); }}
                />
                <button className="primary" onClick={onSave} disabled={!draft.trim() || status.kind === 'busy'}>保存</button>
              </div>
              <p className="hint">保存后页面将自动刷新以应用新 Token。Token 会写入 <code>~/.web_terminal/token</code>。</p>
            </div>

            <div className="modal-section">
              <div className="modal-section-title">随机 Token</div>
              <button className="primary" onClick={onRotate} disabled={status.kind === 'busy'}>🎲 重新生成 64 位随机 Token</button>
            </div>
          </>
        )}

        {conn && (
          <div className="modal-section">
            <div className="modal-section-title">连接信息</div>
            <ul className="conn-list">
              <li><span className="conn-label">Local</span><code className="mono">http://127.0.0.1:{conn.port}/</code></li>
              <li><span className="conn-label">Network</span><code className="mono">http://{conn.ip}:{conn.port}/</code></li>
              <li>
                <span className="conn-label">完整 URL</span>
                <code className="mono conn-url">{conn.url}</code>
                <button className="iconbtn small" title="复制 URL" onClick={() => onCopy(conn.url, 'URL')}>📋</button>
                <button className="iconbtn small" title="刷新 QR" onClick={() => setQrNonce((n) => n + 1)}>↻</button>
              </li>
            </ul>
            {qrSrc && (
              <div className="qr-wrap">
                <img className="qr-img" src={qrSrc} alt="connection QR code" />
                <p className="hint">手机扫码可直接登录（含当前 Token）。</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
