/**
 * Lightweight non-reactive registry mapping leafId → terminal control surface.
 * Avoids prop-drilling the conn from Terminal to side panels and toolbar buttons.
 *
 * `send` writes bytes to the PTY. `focus`/`blur` operate on the xterm DOM
 * textarea — used by the explicit "show keyboard" button on mobile to opt
 * users into the soft keyboard rather than popping it on every stray tap.
 */
export interface TerminalControl {
  send(text: string): void;
  focus(): void;
  blur(): void;
  /** Whether the underlying textarea currently has document focus. */
  isFocused(): boolean;
}

const controls = new Map<string, TerminalControl>();

export const terminalRegistry = {
  register(leafId: string, control: TerminalControl) {
    if (import.meta.env.DEV && controls.has(leafId)) {
      // If this fires, two Terminal components are mounted for the same leafId.
      // Adding `key={pane.id}` in PaneTree should prevent this — file a bug.
      // eslint-disable-next-line no-console
      console.warn('[terminalRegistry] overwriting existing control for', leafId);
    }
    controls.set(leafId, control);
  },
  unregister(leafId: string, control?: TerminalControl) {
    // Only delete if the registered control is the one being unregistered.
    // Prevents a stale cleanup from the previous fiber from clobbering a fresh one.
    if (control && controls.get(leafId) !== control) return;
    controls.delete(leafId);
  },
  send(leafId: string, text: string): boolean {
    const c = controls.get(leafId);
    if (!c) return false;
    c.send(text);
    return true;
  },
  focus(leafId: string): boolean {
    const c = controls.get(leafId);
    if (!c) return false;
    c.focus();
    return true;
  },
  blur(leafId: string): boolean {
    const c = controls.get(leafId);
    if (!c) return false;
    c.blur();
    return true;
  },
  isFocused(leafId: string): boolean {
    return controls.get(leafId)?.isFocused() ?? false;
  }
};
