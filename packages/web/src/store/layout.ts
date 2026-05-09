import { create } from 'zustand';

export type SidePanel = 'bookmarks' | 'history' | 'files' | 'git' | 'snippets' | 'settings' | null;

interface LayoutState {
  drawerOpen: boolean;
  activePanel: SidePanel;
  setDrawer: (open: boolean) => void;
  toggleDrawer: () => void;
  selectPanel: (panel: SidePanel) => void;
}

// Desktop: default open. Mobile: default closed.
const initialDrawerOpen = (() => {
  if (typeof window === 'undefined') return true;
  return window.innerWidth >= 768;
})();

export const useLayoutStore = create<LayoutState>((set, get) => ({
  drawerOpen: initialDrawerOpen,
  activePanel: 'bookmarks',
  setDrawer: (open) => set({ drawerOpen: open }),
  toggleDrawer: () => set({ drawerOpen: !get().drawerOpen }),
  selectPanel: (panel) => set({ activePanel: panel, drawerOpen: panel != null })
}));
