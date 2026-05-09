import { useEffect } from 'react';
import { usePTY } from '../hooks/usePTY';
import { useTabsStore } from '../store/tabs';
import { isTouchPrimary } from '../hooks/useResponsive';
import { PaneCloseButton } from './PaneCloseButton';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  leafId: string;
  initialSessionId?: string;
  initialCwd?: string;
  isActive: boolean;
  tabId: string;
}

export function Terminal({ leafId, initialSessionId, initialCwd, isActive, tabId }: TerminalProps) {
  const { containerRef, fit, focus, blur } = usePTY({ leafId, initialSessionId, initialCwd });
  const selectLeaf = useTabsStore((s) => s.selectLeaf);
  const touchPrimary = isTouchPrimary();

  // Auto-focus only on devices with a real keyboard. On touch devices we never
  // call focus() implicitly — even tapping the terminal area no longer pops
  // the soft keyboard, since users hit nearby buttons (panels, virtual keys)
  // by accident. Use the dedicated ⌨ button in the virtual-keys row to opt in.
  useEffect(() => {
    if (!isActive) {
      // When the terminal becomes inactive, drop focus so the OS dismisses the
      // soft keyboard and cd injections from side panels don't keep it open.
      blur();
      return;
    }
    if (touchPrimary) return;
    const t = setTimeout(() => focus(), 30);
    return () => clearTimeout(t);
  }, [isActive, focus, blur, touchPrimary]);

  // Refit whenever active changes (the terminal might have been hidden / smaller)
  useEffect(() => {
    if (isActive) {
      const t = setTimeout(fit, 50);
      return () => clearTimeout(t);
    }
  }, [isActive, fit]);

  // On touch devices, dismiss any lingering keyboard when the user touches the
  // pane chrome (outside xterm-host). Re-show via the ⌨ virtual key.
  const onPaneTouchStart = (e: React.TouchEvent) => {
    selectLeaf(tabId, leafId);
    if (touchPrimary && e.target === e.currentTarget) blur();
  };

  return (
    <div
      className={`pane terminal-pane ${isActive ? 'is-active' : ''}`}
      onMouseDown={() => selectLeaf(tabId, leafId)}
      onTouchStart={onPaneTouchStart}
    >
      <div
        ref={containerRef}
        className="xterm-host"
        onClick={() => { if (!touchPrimary) focus(); }}
      />
      <PaneCloseButton tabId={tabId} leafId={leafId} />
    </div>
  );
}
