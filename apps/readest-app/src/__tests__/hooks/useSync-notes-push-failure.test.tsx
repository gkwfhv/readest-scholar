import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => {
  const state = {
    settings: { version: 1, lastSyncedAtNotes: 0 },
    setSettings: vi.fn(),
    saveSettings: vi.fn(),
  };
  const client = {
    pushChanges: vi.fn(),
    pullChanges: vi.fn(async () => ({ notes: [] })),
  };
  const setConfig = vi.fn();
  return { state, client, setConfig };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { id: 'env' } }),
}));
vi.mock('@/context/SyncContext', () => ({
  useSyncContext: () => ({ syncClient: h.client }),
}));
vi.mock('@/services/sync/syncCategories', () => ({
  isSyncCategoryEnabled: () => true,
}));
vi.mock('@/store/settingsStore', () => {
  const useSettingsStore = ((selector?: (s: typeof h.state) => unknown) =>
    selector ? selector(h.state) : h.state) as unknown as {
    (): typeof h.state;
    getState: () => typeof h.state;
  };
  useSettingsStore.getState = () => h.state;
  return { useSettingsStore };
});
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => ({ location: 'epubcfi(/6/4!/4/2/1:0)', booknotes: [] }),
    setConfig: h.setConfig,
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ setIsSyncing: vi.fn() }),
}));
vi.mock('@/utils/nav', () => ({ navigateToLogin: vi.fn() }));
vi.mock('@/utils/transform', () => ({
  transformBookFromDB: (x: unknown) => x,
  transformBookNoteFromDB: (x: unknown) => x,
  transformBookConfigFromDB: (x: unknown) => x,
}));

import { useSync } from '@/hooks/useSync';

const note = {
  id: 'offline-annotation',
  type: 'annotation' as const,
  cfi: 'epubcfi(/6/4!/4/2/1:0)',
  text: 'local edit',
  note: '',
  createdAt: 3000,
  updatedAt: 3000,
};

afterEach(() => {
  cleanup();
  h.client.pushChanges.mockReset();
  h.client.pullChanges.mockClear();
  h.setConfig.mockClear();
});

describe('note push failure', () => {
  test('leaves the pull cursor untouched so an unpushed local edit remains eligible for retry', async () => {
    h.client.pushChanges.mockRejectedValueOnce(new Error('offline'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useSync('book-key'));
      await waitFor(() => expect(result.current.useSyncInited).toBe(true));

      let pushed: boolean | undefined;
      await act(async () => {
        pushed = await result.current.syncNotes([note], 'book-hash', 'meta-hash', 'both');
      });

      expect(pushed).toBe(false);
      expect(h.client.pushChanges).toHaveBeenCalledTimes(1);
      expect(h.client.pullChanges).not.toHaveBeenCalled();
      expect(h.setConfig).not.toHaveBeenCalledWith(
        'book-key',
        expect.objectContaining({ lastSyncedAtNotes: expect.any(Number) }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
