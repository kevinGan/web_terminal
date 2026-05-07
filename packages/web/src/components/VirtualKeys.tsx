import { useState } from 'react';
import { typeInActiveTerminal, runInActiveTerminal, getActiveTerminalLeaf } from '../store/active';
import { useTabsStore } from '../store/tabs';
import { ClaudeCommandPicker } from './ClaudeCommandPicker';
import { GitCommandPicker } from './GitCommandPicker';
import { VoiceInputButton } from './VoiceInputButton';

interface KeyDef {
  label: string;
  send?: string;
  /** Run a full command (text + Enter) */
  run?: string;
  /** Custom click handler — overrides send/run. */
  onClick?: () => void;
  className?: string;
  ariaLabel?: string;
  /** When provided, used instead of send/run as a slash-commands picker. */
  picker?: 'claude' | 'git';
  voice?: boolean;
}

const NORMAL_KEYS: KeyDef[] = [
  { label: '🤖 claude', run: 'claude --dangerously-skip-permissions', className: 'claude wide', ariaLabel: 'Start Claude' },
  { label: 'Tab', send: '\t' },
  { label: 'Esc', send: '\x1b' },
  { label: '↑', send: '\x1b[A' },
  { label: '↓', send: '\x1b[B' },
  { label: '←', send: '\x1b[D' },
  { label: '→', send: '\x1b[C' },
  { label: '/', send: '/' },
  { label: '🌿 /git', picker: 'git', className: 'picker' },
  { label: 'Ctrl+C', send: '\x03', className: 'danger' },
  { label: 'Ctrl+D', send: '\x04', className: 'danger' },
  { label: '↵ 回车', send: '\r', className: 'enter wide' }
];

const CLAUDE_KEYS: KeyDef[] = [
  { label: '⇧⇥ Mode', send: '\x1b[Z', className: 'mode wide', ariaLabel: 'Shift+Tab cycle Claude mode' },
  { label: '↵ 回车', send: '\r', className: 'enter' },
  { label: '🎤 语音', voice: true, className: 'voice' },
  { label: '↑', send: '\x1b[A' },
  { label: '↓', send: '\x1b[B' },
  { label: '←', send: '\x1b[D' },
  { label: '→', send: '\x1b[C' },
  { label: '1', send: '1' },
  { label: '2', send: '2' },
  { label: '3', send: '3' },
  { label: '/ 指令', picker: 'claude', className: 'picker wide' },
  { label: 'Esc', send: '\x1b', className: 'danger' }
];

export function VirtualKeys() {
  const [openPicker, setOpenPicker] = useState<'claude' | 'git' | null>(null);

  // Subscribe so the layout re-renders when active leaf or its claudeMode changes.
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  void tabs; void activeTabId;
  const active = getActiveTerminalLeaf();
  const claudeMode = !!(active && active.leaf.kind === 'leaf' && active.leaf.type === 'terminal' && active.leaf.claudeMode);
  const KEYS = claudeMode ? CLAUDE_KEYS : NORMAL_KEYS;

  return (
    <>
      <div
        className={`virtual-keys ${claudeMode ? 'mode-claude' : 'mode-normal'}`}
        role="toolbar"
        aria-label={claudeMode ? 'Claude Code keys' : 'shell keys'}
      >
        {KEYS.map((k) => {
          if (k.voice) return <VoiceInputButton key={k.label} className={`vk ${k.className ?? ''}`} />;
          return (
            <button
              key={k.label}
              className={`vk ${k.className ?? ''}`}
              aria-label={k.ariaLabel ?? k.label}
              onPointerDown={(e) => {
                e.preventDefault();
                if (k.picker) {
                  setOpenPicker(k.picker);
                  return;
                }
                if (k.onClick) k.onClick();
                else if (k.run != null) runInActiveTerminal(k.run);
                else if (k.send != null) typeInActiveTerminal(k.send);
              }}
            >{k.label}</button>
          );
        })}
      </div>
      {openPicker === 'claude' && <ClaudeCommandPicker onClose={() => setOpenPicker(null)} />}
      {openPicker === 'git' && <GitCommandPicker onClose={() => setOpenPicker(null)} />}
    </>
  );
}
