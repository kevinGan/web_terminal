import { api, type PersistedWorkspace } from '../api/http';
import { getIdCounter, useTabsStore } from './tabs';

let started = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSerialized = '';

const SAVE_DEBOUNCE_MS = 300;

/**
 * Boot-time bootstrap:
 *   1. Pull the persisted workspace from the server (or initialize empty).
 *   2. Mark store hydrated → App renders PaneTrees.
 *   3. Subscribe to store changes; debounce-PUT them back to the server so any
 *      tab/pane/cwd/sessionId mutation survives a refresh and is visible from
 *      another browser pointing at the same server.
 *
 * This must run exactly once per page load. Calling it again is a no-op.
 */
export async function bootstrapPersistence(): Promise<void> {
  if (started) return;
  started = true;

  let snapshot: PersistedWorkspace = {
    schemaVersion: 1,
    tabs: [],
    activeTabId: '',
    idCounter: 0
  };
  try {
    snapshot = await api.state.load();
  } catch {
    // First launch / network blip — fall through with the empty default.
  }

  useTabsStore.getState().hydrate({
    // Cast: server treats tabs as opaque; client knows the real shape.
    tabs: (snapshot.tabs ?? []) as ReturnType<typeof useTabsStore.getState>['tabs'],
    activeTabId: snapshot.activeTabId ?? '',
    idCounter: snapshot.idCounter ?? 0
  });

  // After hydration, persist on every change (debounced).
  useTabsStore.subscribe((state) => {
    if (!state.hydrated) return;
    const payload: PersistedWorkspace = {
      schemaVersion: 1,
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      idCounter: getIdCounter()
    };
    const serialized = JSON.stringify(payload);
    if (serialized === lastSerialized) return;
    lastSerialized = serialized;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      api.state.save(payload).catch(() => {
        // Best-effort: drop transient failures, the next mutation will retry.
      });
    }, SAVE_DEBOUNCE_MS);
  });

  // On unload, fire the debounced save synchronously (best-effort) so the last
  // mutation persists even if the user refreshes within the debounce window.
  window.addEventListener('pagehide', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      const state = useTabsStore.getState();
      const payload: PersistedWorkspace = {
        schemaVersion: 1,
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        idCounter: getIdCounter()
      };
      // Use keepalive fetch so the request survives the page transition.
      const token = sessionStorage.getItem('wt_token') ?? '';
      try {
        fetch('/api/state', {
          method: 'PUT',
          keepalive: true,
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify(payload)
        }).catch(() => {});
      } catch {}
    }
  });
}
