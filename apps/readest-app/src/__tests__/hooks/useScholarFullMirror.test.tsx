import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTransferStore, type TransferItem } from '@/store/transferStore';
import { setScholarFileCacheMode } from '@/services/scholarFileCacheMode';

const accountId = '00000000-0000-4000-8000-000000000001';
const queueDownload = vi.fn();
const stopScholarFullMirror = vi.fn();
const getAccount = vi.fn();
vi.mock('@/services/environment', async (original) => ({
  ...(await original<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => true,
  isScholarReleaseBundle: () => true,
}));
vi.mock('@/services/scholarFileBaseline', () => ({ getScholarAccountId: () => getAccount() }));
vi.mock('@/services/transferManager', () => ({
  transferManager: {
    waitUntilReady: () => Promise.resolve(),
    queueDownload: (...args: unknown[]) => queueDownload(...args),
    stopScholarFullMirror: (...args: unknown[]) => stopScholarFullMirror(...args),
  },
}));
import { useScholarFullMirror } from '@/hooks/useScholarFullMirror';

const makeBook = (hash: string): Book =>
  ({
    hash,
    title: hash,
    format: 'PDF',
    uploadedAt: 1,
    downloadedAt: null,
  }) as Book;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  queueDownload.mockReset();
  stopScholarFullMirror.mockReset();
  getAccount.mockResolvedValue(accountId);
  useLibraryStore.setState({ library: [makeBook('paper-a')] });
  useTransferStore.setState({ transfers: {} });
  useSettingsStore.setState({ settings: { version: 1, readestCloud: { enabled: true } } as never });
  queueDownload.mockImplementation((book: Book) => {
    const task = {
      id: book.hash,
      bookHash: book.hash,
      kind: 'book',
      type: 'download',
      status: 'pending',
      scholarAccountId: accountId,
    } as TransferItem;
    useTransferStore.setState((state) => ({ transfers: { ...state.transfers, [task.id]: task } }));
    return task.id;
  });
});
afterEach(() => vi.useRealTimers());

test('full mirror queues only remote-only files after opt-in and library growth', async () => {
  const appService = { isBookAvailable: vi.fn().mockResolvedValue(false) } as unknown as AppService;
  const { unmount } = renderHook(() => useScholarFullMirror(accountId, true, appService));
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  expect(queueDownload).not.toHaveBeenCalled();

  await act(async () => {
    setScholarFileCacheMode(accountId, 'full_mirror');
    await vi.runAllTimersAsync();
  });
  expect(queueDownload).toHaveBeenCalledWith(
    expect.objectContaining({ hash: 'paper-a' }),
    20,
    true,
    true,
  );
  expect(queueDownload).toHaveBeenCalledTimes(1);

  await act(async () => {
    useLibraryStore.setState({ library: [makeBook('paper-a'), makeBook('paper-b')] });
    await vi.runAllTimersAsync();
  });
  expect(queueDownload).toHaveBeenCalledTimes(2);
  expect(queueDownload).toHaveBeenLastCalledWith(
    expect.objectContaining({ hash: 'paper-b' }),
    20,
    true,
    true,
  );
  unmount();
});

test('turning off full mirror stops this account automatic downloads', async () => {
  const appService = { isBookAvailable: vi.fn().mockResolvedValue(false) } as unknown as AppService;
  setScholarFileCacheMode(accountId, 'full_mirror');
  const { unmount } = renderHook(() => useScholarFullMirror(accountId, true, appService));
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  expect(queueDownload).toHaveBeenCalledTimes(1);
  expect(stopScholarFullMirror).not.toHaveBeenCalled();

  await act(async () => {
    setScholarFileCacheMode(accountId, 'on_demand');
    await vi.runAllTimersAsync();
  });
  expect(stopScholarFullMirror).toHaveBeenCalledWith(accountId);
  expect(queueDownload).toHaveBeenCalledTimes(1);
  unmount();
});

test('a newer cloud file is queued even when older local bytes still exist', async () => {
  const oldBook = { ...makeBook('paper-new'), uploadedAt: 200, downloadedAt: 100 };
  useLibraryStore.setState({ library: [oldBook] });
  setScholarFileCacheMode(accountId, 'full_mirror');
  const appService = { isBookAvailable: vi.fn().mockResolvedValue(true) } as unknown as AppService;
  const { unmount } = renderHook(() => useScholarFullMirror(accountId, true, appService));
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  expect(queueDownload).toHaveBeenCalledWith(oldBook, 20, true, true);
  expect(appService.isBookAvailable).not.toHaveBeenCalled();
  unmount();
});
