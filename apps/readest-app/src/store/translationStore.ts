import { create } from 'zustand';

import type { TranslationOutputKind } from '@/types/book';

interface TranslationState {
  /**
   * The translated form the reader should load for the NEXT open, keyed by book
   * hash. Written immediately before navigating and consumed exactly once by
   * readerStore.initViewState, so every open asks again.
   */
  openMode: Record<string, TranslationOutputKind>;
  setOpenMode: (hash: string, kind: TranslationOutputKind) => void;
  takeOpenMode: (hash: string) => TranslationOutputKind | undefined;

  /** Hashes with a download/finalize in flight, so two pollers cannot race. */
  finalizing: Set<string>;
  beginFinalize: (hash: string) => boolean;
  endFinalize: (hash: string) => void;
}

export const useTranslationStore = create<TranslationState>((set, get) => ({
  openMode: {},
  finalizing: new Set<string>(),

  setOpenMode: (hash, kind) => set((state) => ({ openMode: { ...state.openMode, [hash]: kind } })),

  takeOpenMode: (hash) => {
    const kind = get().openMode[hash];
    if (kind) {
      set((state) => {
        const next = { ...state.openMode };
        delete next[hash];
        return { openMode: next };
      });
    }
    return kind;
  },

  beginFinalize: (hash) => {
    if (get().finalizing.has(hash)) return false;
    set((state) => ({ finalizing: new Set(state.finalizing).add(hash) }));
    return true;
  },

  endFinalize: (hash) =>
    set((state) => {
      const next = new Set(state.finalizing);
      next.delete(hash);
      return { finalizing: next };
    }),
}));
