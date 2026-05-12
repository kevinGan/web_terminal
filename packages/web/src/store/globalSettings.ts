import { create } from 'zustand';

interface GlobalSettingsState {
  open: boolean;
  openModal(): void;
  closeModal(): void;
}

export const useGlobalSettingsStore = create<GlobalSettingsState>((set) => ({
  open: false,
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false })
}));
