import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

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
  const bookmark = {
    id: 'offline-bookmark',
    type: 'bookmark',
    cfi: 'epubcfi(/6/4!/4/2/1:0)',
    createdAt: 3000,
    updatedAt: 3000,
  };
  return {
    makeStore,
    bookmark,
    syncNotesMock: vi.fn(async () => true),
    state: { config: { location: 'epubcfi(/6/4!/4/2/1:0)', booknotes: [bookmark] } },
  };
});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { saveBookConfig: vi.fn(async () => {}) } }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {} }),
}));

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
    getBookData: () => ({ book: { hash: 'h1', format: 'PDF', metaHash: 'm1' } }),
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: h.makeStore({ getView: () => null, getViewsById: () => [] }),
}));

import { useNotesSync } from '@/app/reader/hooks/useNotesSync';

describe('useNotesSync after an offline push', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.syncNotesMock.mockReset();
    h.syncNotesMock.mockResolvedValueOnce(false).mockResolvedValue(true);
    h.state.config = { location: 'epubcfi(/6/4!/4/2/1:0)', booknotes: [h.bookmark] };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test('an older success cannot clear a newer failed upload', async () => {
    let resolveFirst: (value: boolean) => void = () => {};
    let resolveSecond: (value: boolean) => void = () => {};
    h.syncNotesMock.mockReset();
    h.syncNotesMock
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveSecond = resolve;
          }),
      )
      .mockResolvedValue(true);

    const { rerender } = renderHook(() => useNotesSync('h1-key'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.syncNotesMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    h.state.config = {
      ...h.state.config,
      booknotes: [{ ...h.bookmark, updatedAt: 4000 }],
    };
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(h.syncNotesMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSecond(false);
      await Promise.resolve();
    });
    await act(async () => {
      resolveFirst(true);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(h.syncNotesMock).toHaveBeenCalledTimes(3);
  });

  test('retries the same locally saved bookmark when connectivity returns without a browser online event', async () => {
    const { unmount } = renderHook(() => useNotesSync('h1-key'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.syncNotesMock).toHaveBeenCalledTimes(1);
    expect(h.syncNotesMock).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'offline-bookmark' })],
      'h1',
      'm1',
      'both',
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(h.syncNotesMock).toHaveBeenCalledTimes(2);
    const calls = h.syncNotesMock.mock.calls as unknown as [Array<{ id: string }>, ...unknown[]][];
    expect(calls[1]?.[0]).toEqual(calls[0]?.[0]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(h.syncNotesMock).toHaveBeenCalledTimes(2);
    unmount();
  });
});
