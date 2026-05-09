import { useTabsStore, findLeaf, firstTerminal, type Pane } from './tabs';
import { terminalRegistry } from './terminalRegistry';

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

/**
 * Toggle the soft keyboard for the active terminal. Returns true if the
 * keyboard is now showing (textarea was focused), false if hidden or no-op.
 * Used by the dedicated ⌨ button on mobile.
 */
export function toggleActiveTerminalKeyboard(): boolean {
  const a = getActiveTerminalLeaf();
  if (!a) return false;
  if (terminalRegistry.isFocused(a.leaf.id)) {
    terminalRegistry.blur(a.leaf.id);
    return false;
  }
  terminalRegistry.focus(a.leaf.id);
  return true;
}
