import { useNotifyStore } from '../store/notifications';

export function NotificationToggle() {
  const perm = useNotifyStore((s) => s.perm);
  const enabled = useNotifyStore((s) => s.enabled);
  const request = useNotifyStore((s) => s.request);
  const setEnabled = useNotifyStore((s) => s.setEnabled);
  const notify = useNotifyStore((s) => s.notify);

  if (perm === 'unsupported') {
    return <div className="notify-toggle muted">该浏览器不支持桌面通知</div>;
  }
  type ResolvedPerm = Exclude<typeof perm, 'unsupported'>;
  const p = perm as ResolvedPerm;

  const onClick = async () => {
    if (perm === 'granted') {
      const next = !enabled;
      setEnabled(next);
      if (next) notify('Web Terminal 通知已启用', '当 Claude Code 等待输入时会提醒你。', { force: true });
      return;
    }
    if (perm === 'denied') {
      // Chrome/Safari ignore further requestPermission once denied; user must enable in site settings.
      alert('浏览器已拒绝通知权限。请在站点设置中手动允许。');
      return;
    }
    const result = await request();
    if (result === 'granted') {
      setEnabled(true);
      notify('Web Terminal 通知已启用', '当 Claude Code 等待输入时会提醒你。', { force: true });
    }
  };

  const labels: Record<ResolvedPerm, string> = {
    granted: enabled ? '🔔 通知已开启 — 点击关闭' : '🔕 通知已关闭 — 点击开启',
    denied: '🚫 通知被拒绝 (站点设置中可改)',
    default: '🔔 启用通知（Claude 等输入时提醒）'
  };

  return (
    <button
      className={`notify-toggle ${p === 'granted' && enabled ? 'on' : ''}`}
      onClick={onClick}
      title="通知仅在页面在后台时弹出"
    >{labels[p]}</button>
  );
}
