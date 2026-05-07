/**
 * Lightweight non-reactive registry mapping leafId → input sender.
 * Avoids prop-drilling the conn from Terminal to side panels.
 */
type Sender = (text: string) => void;

const senders = new Map<string, Sender>();

export const terminalRegistry = {
  register(leafId: string, send: Sender) {
    if (import.meta.env.DEV && senders.has(leafId)) {
      // If this fires, two Terminal components are mounted for the same leafId.
      // Adding `key={pane.id}` in PaneTree should prevent this — file a bug.
      // eslint-disable-next-line no-console
      console.warn('[terminalRegistry] overwriting existing sender for', leafId);
    }
    senders.set(leafId, send);
  },
  unregister(leafId: string, send?: Sender) {
    // Only delete if the registered sender is the one being unregistered.
    // Prevents a stale cleanup from the previous fiber from clobbering a fresh one.
    if (send && senders.get(leafId) !== send) return;
    senders.delete(leafId);
  },
  send(leafId: string, text: string): boolean {
    const fn = senders.get(leafId);
    if (!fn) return false;
    fn(text);
    return true;
  }
};
