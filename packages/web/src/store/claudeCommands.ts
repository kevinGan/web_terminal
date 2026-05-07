import { create } from 'zustand';
import { http } from '../api/http';

export interface ClaudeCommand {
  id: string;
  label: string;
  command: string;
  autoSubmit?: boolean;
  addedAt: number;
}

interface State {
  list: ClaudeCommand[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (command: string, label?: string, autoSubmit?: boolean) => Promise<void>;
  update: (id: string, patch: Partial<Pick<ClaudeCommand, 'label' | 'command' | 'autoSubmit'>>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
}

export const useClaudeCommandsStore = create<State>((set) => ({
  list: [],
  loaded: false,

  load: async () => {
    try {
      const list = await http.get<ClaudeCommand[]>('/api/claude-commands');
      set({ list, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  add: async (command, label, autoSubmit = true) => {
    const r = await http.post<{ all: ClaudeCommand[] }>('/api/claude-commands', { command, label, autoSubmit });
    set({ list: r.all });
  },

  update: async (id, patch) => {
    const r = await http.put<{ all: ClaudeCommand[] }>(`/api/claude-commands/${id}`, patch);
    set({ list: r.all });
  },

  remove: async (id) => {
    const r = await http.del<{ all: ClaudeCommand[] }>(`/api/claude-commands/${id}`);
    set({ list: r.all });
  },

  reorder: async (ids) => {
    const r = await http.put<{ all: ClaudeCommand[] }>('/api/claude-commands/reorder', { ids });
    set({ list: r.all });
  }
}));
