import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

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

  return {
    makeStore,
    state: {
      config: {
        location: 'epubcfi(/6/2)',
        booknotes: [] as Array<{
          id: string;
          type: string;
          cfi: string;
          createdAt: number;
          updatedAt: number;
          deletedAt?: number;
        }>,
      },
    },
    book: { hash: 'pdf-hash', format: 'PDF', metaHash: 'meta' },
    syncNotesMock: vi.fn(async () => true),
  };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

vi.mock('@/hooks/useSync', () => ({
  useSync: () => ({ syncedNotes: null, syncNotes: h.syncNotesMock, lastSyncedAtNotes: 2000 }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: h.makeStore({
    getConfig: () => h.state.config,
    setConfig: vi.fn(),
    getBookData: () => ({ book: h.book }),
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: h.makeStore({ getView: () => null, getViewsById: () => [] }),
}));

import { useNotesSync } from '@/app/reader/hooks/useNotesSync';

const bookmark = {
  id: 'b1',
  type: 'bookmark',
  cfi: 'epubcfi(/6/2)',
  createdAt: 1000,
  updatedAt: 1000,
};

describe('PDF bookmarks after a completed note sync', () => {
  beforeEach(() => {
    h.syncNotesMock.mockClear();
    h.book.format = 'PDF';
    h.state.config = { location: 'epubcfi(/6/2)', booknotes: [{ ...bookmark }] };
  });

  afterEach(() => cleanup());

  test('does not push an unchanged bookmark merely because PDF has no xpointer', async () => {
    renderHook(() => useNotesSync('pdf-key'));
    await waitFor(() => expect(h.syncNotesMock).toHaveBeenCalled());
    expect(h.syncNotesMock).toHaveBeenCalledWith([], 'pdf-hash', 'meta', 'both');
    expect(h.syncNotesMock).toHaveBeenCalledTimes(1);
  });

  test('still pushes a newer PDF bookmark', async () => {
    h.state.config.booknotes = [{ ...bookmark, updatedAt: 3000 }];
    renderHook(() => useNotesSync('pdf-key'));
    await waitFor(() =>
      expect(h.syncNotesMock).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'b1', updatedAt: 3000 })],
        'pdf-hash',
        'meta',
        'both',
      ),
    );
  });

  test('still pushes a newer PDF tombstone', async () => {
    h.state.config.booknotes = [{ ...bookmark, deletedAt: 3000 }];
    renderHook(() => useNotesSync('pdf-key'));
    await waitFor(() =>
      expect(h.syncNotesMock).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'b1', deletedAt: 3000 })],
        'pdf-hash',
        'meta',
        'both',
      ),
    );
  });

  test('does not repeatedly push an old EPUB tombstone missing its xpointer', async () => {
    h.book.format = 'EPUB';
    h.state.config.booknotes = [{ ...bookmark, deletedAt: 1500 }];
    renderHook(() => useNotesSync('pdf-key'));
    await waitFor(() =>
      expect(h.syncNotesMock).toHaveBeenCalledWith([], 'pdf-hash', 'meta', 'both'),
    );
  });

  test('continues to enrich a live EPUB note missing its xpointer', async () => {
    h.book.format = 'EPUB';
    renderHook(() => useNotesSync('pdf-key'));
    await waitFor(() =>
      expect(h.syncNotesMock).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'b1' })],
        'pdf-hash',
        'meta',
        'both',
      ),
    );
  });
});
