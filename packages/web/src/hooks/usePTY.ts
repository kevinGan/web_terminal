import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SearchAddon } from '@xterm/addon-search';
import { PtyConn } from '../api/ws';
import { useTabsStore } from '../store/tabs';
import { terminalRegistry } from '../store/terminalRegistry';
import { usePromptDetector } from './usePromptDetector';
import { useClaudeModeDetector } from './useClaudeModeDetector';
import { useNotifyStore } from '../store/notifications';
import type { Pane } from '../store/tabs';

function findLeafId(pane: Pane, id: string): boolean {
  if (pane.kind === 'leaf') return pane.id === id;
  return findLeafId(pane.a, id) || findLeafId(pane.b, id);
}

export interface UsePTYOptions {
  leafId: string;
  initialSessionId?: string;
  initialCwd?: string;
}

export interface UsePTYResult {
  containerRef: React.RefObject<HTMLDivElement>;
  fit: () => void;
  paste: (text: string) => void;
  type: (text: string) => void;
  focus: () => void;
  blur: () => void;
  isReady: boolean;
}

export function usePTY({ leafId, initialSessionId, initialCwd }: UsePTYOptions): UsePTYResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const connRef = useRef<PtyConn | null>(null);
  const sessionIdRef = useRef<string | undefined>(initialSessionId);
  const [isReady, setIsReady] = useState(false);

  // setLeafSession etc. are stable (zustand setters); pull at call time.
  const tabs = useTabsStore;
  const notify = useNotifyStore((s) => s.notify);

  // Claude Code mode detector: switches the virtual keyboard between
  // "shell" and "Claude" presets based on whether the recent output frames
  // a Claude Code rounded input box.
  const claudeDetector = useClaudeModeDetector({
    enabled: true,
    onChange: (inClaude) => {
      useTabsStore.getState().setLeafClaudeMode(leafId, inClaude);
    }
  });

  // Prompt detector: fire a notification when Claude / interactive program
  // is waiting for input AND the page is hidden.
  const detector = usePromptDetector({
    enabled: true,
    onPromptDetected: ({ trigger, preview }) => {
      const tabsState = useTabsStore.getState();
      const tab = tabsState.tabs.find((t) => findLeafId(t.root, leafId));
      const tabLabel = tab?.label ?? 'Terminal';
      notify(`${tabLabel} 等待输入`, preview || trigger, {
        tag: `wt-prompt-${leafId}`,
        onClick: () => {
          if (tab) tabsState.selectTab(tab.id);
          tabsState.selectLeaf(tab?.id ?? '', leafId);
        }
      });
    }
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      scrollback: 5000,
      allowProposedApi: true,
      macOptionIsMeta: true,
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        cursorAccent: '#1e1e2e',
        selectionBackground: '#585b70',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8'
      }
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    const u11 = new Unicode11Addon();
    term.loadAddon(u11);
    term.unicode.activeVersion = '11';
    term.loadAddon(new SearchAddon());

    term.open(containerRef.current);
    try { fit.fit(); } catch {}

    xtermRef.current = term;
    fitRef.current = fit;

    const conn = new PtyConn(
      () => ({
        type: 'init',
        sessionId: sessionIdRef.current,
        cols: term.cols,
        rows: term.rows,
        cwd: initialCwd
      }),
      {
        onBinary: (bytes) => {
          term.write(bytes);
          detector.feed(bytes);
          claudeDetector.feed(bytes);
        },
        onControl: (msg) => {
          if (msg.type === 'ready') {
            sessionIdRef.current = msg.sessionId;
            tabs.getState().setLeafSession(leafId, msg.sessionId);
            if (msg.cwd) tabs.getState().setLeafCwd(leafId, msg.cwd);
            setIsReady(true);
          } else if (msg.type === 'cwd') {
            tabs.getState().setLeafCwd(leafId, msg.path);
          } else if (msg.type === 'title') {
            tabs.getState().setLeafTitle(leafId, msg.text);
          } else if (msg.type === 'exit') {
            term.writeln(`\r\n[process exited: code=${msg.exitCode}${msg.signal ? ` signal=${msg.signal}` : ''}]`);
          }
        },
        onClose: () => {
          term.writeln('\r\n[connection closed]');
        }
      }
    );
    conn.open();
    connRef.current = conn;
    const sender = (text: string) => conn.sendInput(text);
    terminalRegistry.register(leafId, sender);

    const dispDataRaw = term.onData((data) => conn.sendInput(data));
    const dispResize = term.onResize(({ cols, rows }) => conn.resize(cols, rows));

    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch {}
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      dispDataRaw.dispose();
      dispResize.dispose();
      terminalRegistry.unregister(leafId, sender);
      conn.close();
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
      connRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafId]);

  return {
    containerRef,
    fit: () => { try { fitRef.current?.fit(); } catch {} },
    paste: (text: string) => {
      const conn = connRef.current;
      if (!conn) return;
      conn.sendInput(text);
    },
    type: (text: string) => {
      const conn = connRef.current;
      if (!conn) return;
      conn.sendInput(text);
    },
    focus: () => xtermRef.current?.focus(),
    blur: () => xtermRef.current?.blur(),
    isReady
  };
}
