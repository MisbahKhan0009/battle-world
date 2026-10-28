import { create } from 'zustand';

type UiState = {
  exportOpen: boolean;
  presetsOpen: boolean;
  paletteOpen: boolean;
  set: (patch: Partial<Omit<UiState, 'set'>>) => void;
};

/** Transient (non-persisted) UI state shared across screens. */
export const useUi = create<UiState>((set) => ({
  exportOpen: false,
  presetsOpen: false,
  paletteOpen: false,
  set: (patch) => set(patch),
}));
