import { useTabsStore, type Pane } from './tabs';
import { terminalRegistry } from './terminalRegistry';

function findLeaf(pane: Pane, id: string): Pane | null {
  if (pane.kind === 'leaf') return pane.id === id ? pane : null;
  return findLeaf(pane.a, id) ?? findLeaf(pane.b, id);
}

export function getActiveTerminalLeaf(): { tabId: string; leaf: Pane } | null {
  const s = useTabsStore.getState();
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  if (!tab) return null;
  const leaf = findLeaf(tab.root, tab.activeLeafId);
  if (!leaf || leaf.kind !== 'leaf' || leaf.type !== 'terminal') {
    // Fall back to the first terminal leaf in tab
    const fallback = firstTerminal(tab.root);
    if (!fallback) return null;
    return { tabId: tab.id, leaf: fallback };
  }
  return { tabId: tab.id, leaf };
}

function firstTerminal(pane: Pane): Pane | null {
  if (pane.kind === 'leaf') return pane.type === 'terminal' ? pane : null;
  return firstTerminal(pane.a) ?? firstTerminal(pane.b);
}

/**
 * Send `cd <path>` (newline-terminated) to the active terminal.
 */
export function cdActiveTerminal(path: string): boolean {
  const a = getActiveTerminalLeaf();
  if (!a) return false;
  const escaped = path.replace(/'/g, "'\\''");
  return terminalRegistry.send(a.leaf.id, `cd '${escaped}'\n`);
}

/**
 * Type a command into the active terminal without auto-executing.
 */
export function typeInActiveTerminal(text: string): boolean {
  const a = getActiveTerminalLeaf();
  if (!a) return false;
  return terminalRegistry.send(a.leaf.id, text);
}

/**
 * Type a command and press Enter.
 */
export function runInActiveTerminal(command: string): boolean {
  const a = getActiveTerminalLeaf();
  if (!a) return false;
  return terminalRegistry.send(a.leaf.id, command + '\n');
}

export function activeCwd(): string | null {
  const a = getActiveTerminalLeaf();
  if (!a || a.leaf.kind !== 'leaf' || a.leaf.type !== 'terminal') return null;
  return a.leaf.cwd ?? null;
}
