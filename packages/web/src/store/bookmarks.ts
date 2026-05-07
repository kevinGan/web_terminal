import { create } from 'zustand';
import { api, type Bookmark, type Snippet, type CdHistoryEntry } from '../api/http';

interface RemoteState {
  bookmarks: Bookmark[];
  snippets: Snippet[];
  cdHistory: CdHistoryEntry[];
  loaded: boolean;
  loadAll: () => Promise<void>;
  pinPath: (path: string, label?: string) => Promise<void>;
  removeBookmark: (id: string) => Promise<void>;
  addSnippet: (command: string, label?: string) => Promise<void>;
  removeSnippet: (id: string) => Promise<void>;
}

export const useRemoteStore = create<RemoteState>((set, get) => ({
  bookmarks: [],
  snippets: [],
  cdHistory: [],
  loaded: false,

  loadAll: async () => {
    const [bookmarks, snippets, history] = await Promise.all([
      api.bookmarks.list().catch(() => []),
      api.snippets.list().catch(() => []),
      api.history.cd(40).catch(() => ({ entries: [] as CdHistoryEntry[], file: '' }))
    ]);
    set({ bookmarks, snippets, cdHistory: history.entries, loaded: true });
  },

  pinPath: async (path, label) => {
    const { all } = await api.bookmarks.add(path, label);
    set({ bookmarks: all });
  },

  removeBookmark: async (id) => {
    const { all } = await api.bookmarks.remove(id);
    set({ bookmarks: all });
  },

  addSnippet: async (command, label) => {
    const { all } = await api.snippets.add(command, label);
    set({ snippets: all });
  },

  removeSnippet: async (id) => {
    const { all } = await api.snippets.remove(id);
    set({ snippets: all });
  }
}));
