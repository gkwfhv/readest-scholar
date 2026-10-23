import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { BookNote } from '@/types/book';

const h = vi.hoisted(() => {
  const makeStore = <T,>(state: T) => {
    const fn = <R,>(selector?: (s: T) => R) => (selector ? selector(state) : state) as R | T;
    (fn as unknown as { getState: () => T }).getState = () => state;
    return fn as {
      (): T;
      <R>(selector: (s: T) => R): R;
      getState: () => T;
    };
  };
  const book = { hash: 'pdf-hash', metaHash: 'meta', format: 'PDF' };
  const config = {
    location: 'page-1',
    updatedAt: 1000,
    booknotes: [] as BookNote[],
  };
  return {
    makeStore,
    book,
    state: { config, syncedNotes: null as BookNote[] | null },
    saveBookConfig: vi.fn(async () => {}),
    setConfig: vi.fn(),
    syncNotes: vi.fn(async () => true),
  };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { saveBookConfig: h.saveBookConfig } }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {} }),
}));
vi.mock('@/hooks/useSync', () => ({
  useSync: () => ({
    syncedNotes: h.state.syncedNotes,
    syncNotes: h.syncNotes,
    lastSyncedAtNotes: 2000,
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: h.makeStore({
    getConfig: () => h.state.config,
    setConfig: (key: string, update: { booknotes: BookNote[] }) => {
      h.setConfig(key, update);
      h.state.config = { ...h.state.config, ...update };
    },
    getBookData: () => ({ book: h.book }),
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: h.makeStore({ getView: () => null, getViewsById: () => [] }),
}));

import { useNotesSync } from '@/app/reader/hooks/useNotesSync';

const remoteNote: BookNote = {
  id: 'remote-annotation',
  type: 'annotation',
  cfi: 'page-2',
  bookHash: 'pdf-hash',
  metaHash: 'meta',
  text: 'selected text',
  note: 'remote content',
  createdAt: 3000,
  updatedAt: 3000,
};

describe('useNotesSync remote note durability', () => {
  beforeEach(() => {
    h.state.config = { location: 'page-1', updatedAt: 1000, booknotes: [] };
    h.state.syncedNotes = null;
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  test('writes a pulled annotation to the book config before a later graceful close', async () => {
    h.state.syncedNotes = [{ ...remoteNote }];
    renderHook(() => useNotesSync('pdf-hash-reader'));

    await waitFor(() => expect(h.setConfig).toHaveBeenCalled());
    await waitFor(() => expect(h.saveBookConfig).toHaveBeenCalled());
    expect(h.saveBookConfig).toHaveBeenCalledWith(
      h.book,
      expect.objectContaining({
        updatedAt: 1000,
        booknotes: [expect.objectContaining({ id: 'remote-annotation', note: 'remote content' })],
      }),
      expect.anything(),
    );
  });
});
