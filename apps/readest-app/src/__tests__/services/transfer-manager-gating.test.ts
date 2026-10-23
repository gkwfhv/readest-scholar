import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTransferStore, TransferItem } from '@/store/transferStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';

const scholarRelease = vi.fn();
const scholarAccountId = vi.fn();
const scholarBaseline = vi.fn();
const saveScholarBaseline = vi.fn();
const fetchWithAuth = vi.fn();
vi.mock('@/services/environment', async (original) => ({
  ...(await original<typeof import('@/services/environment')>()),
  isScholarReleaseBundle: () => scholarRelease(),
}));
vi.mock('@/services/scholarFileBaseline', () => ({
  getScholarAccountId: () => scholarAccountId(),
  getScholarFileBaseline: (...args: unknown[]) => scholarBaseline(...args),
  saveScholarFileBaseline: (...args: unknown[]) => saveScholarBaseline(...args),
}));

vi.mock('@/utils/fetch', () => ({ fetchWithAuth: (...args: unknown[]) => fetchWithAuth(...args) }));

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: vi.fn(),
    dispatchSync: vi.fn(),
  },
}));

import { transferManager } from '@/services/transferManager';
import { eventDispatcher } from '@/utils/event';
import type { Book } from '@/types/book';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'hash1',
    format: 'EPUB',
    title: 'Test Book',
    author: 'Author',
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

function makeTransferItem(overrides: Partial<TransferItem> = {}): TransferItem {
  return {
    id: 't1',
    kind: 'book',
    bookHash: 'hash1',
    bookTitle: 'Test Book',
    type: 'upload',
    status: 'pending',
    progress: 0,
    totalBytes: 0,
    transferredBytes: 0,
    transferSpeed: 0,
    retryCount: 0,
    maxRetries: 3,
    createdAt: Date.now(),
    priority: 10,
    isBackground: false,
    ...overrides,
  };
}

const resetTransferManager = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only introspection
  const mgr = transferManager as unknown as Record<string, unknown>;
  mgr['isInitialized'] = false;
  mgr['scholarAccountId'] = null;
  mgr['isProcessing'] = false;
  mgr['processRequested'] = false;
  mgr['appService'] = null;
  mgr['getLibrary'] = null;
  mgr['updateBook'] = null;
  mgr['_'] = null;
  (mgr['abortControllers'] as Map<string, AbortController>).clear();
  let resolveReady: () => void = () => {};
  mgr['readyPromise'] = new Promise<void>((res) => {
    resolveReady = res;
  });
  mgr['readyResolve'] = resolveReady;
};

const resetTransferStore = () => {
  useTransferStore.setState({
    transfers: {},
    isQueuePaused: false,
    isTransferQueueOpen: false,
    maxConcurrent: 2,
    activeCount: 0,
  });
};

const settingsLoaded = (overrides: Partial<SystemSettings> = {}): void => {
  useSettingsStore.setState({
    settings: {
      version: 1,
      webdav: { enabled: false },
      googleDrive: { enabled: false },
      ...overrides,
    } as SystemSettings,
  });
};

const settingsNotLoaded = (): void => {
  useSettingsStore.setState({ settings: {} as SystemSettings });
};

const webdavSelected = (): void =>
  settingsLoaded({ webdav: { enabled: true } } as Partial<SystemSettings>);

const booksSyncOff = (): void =>
  settingsLoaded({ syncCategories: { book: false } } as Partial<SystemSettings>);

function makeAppService(overrides: Record<string, unknown> = {}) {
  return {
    uploadBook: vi.fn().mockResolvedValue(undefined),
    createScholarUploadSnapshot: vi.fn().mockResolvedValue(3),
    exists: vi.fn().mockResolvedValue(true),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    downloadBook: vi.fn().mockResolvedValue(undefined),
    deleteBook: vi.fn().mockResolvedValue(undefined),
    uploadReplicaFile: vi.fn().mockResolvedValue(undefined),
    downloadReplicaFile: vi.fn().mockResolvedValue(undefined),
    deleteReplicaBundle: vi.fn().mockResolvedValue(undefined),
    isMacOSApp: false,
    ...overrides,
  } as Record<string, unknown>;
}

const translationFn = (key: string, params?: Record<string, string | number>) => {
  if (params) {
    return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)), key);
  }
  return key;
};

const initManager = async (appService = makeAppService(), library: Book[] = []) => {
  await transferManager.initialize(appService as never, () => library, vi.fn(), translationFn);
  return appService;
};

const flushAsync = async (ms = 5000) => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetTransferStore();
  resetTransferManager();
  vi.clearAllMocks();
  scholarRelease.mockReturnValue(false);
  scholarAccountId.mockResolvedValue(null);
  scholarBaseline.mockReturnValue(undefined);
  fetchWithAuth.mockReset().mockResolvedValue({ json: async () => ({}) });
  localStorage.clear();
  settingsLoaded();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Scholar file queue baseline', () => {
  const userA = '00000000-0000-4000-8000-000000000001';
  const userB = '00000000-0000-4000-8000-000000000002';
  const versionId = '00000000-0000-4000-8000-000000000003';
  test('captures the device-known version when the upload is queued', async () => {
    scholarRelease.mockReturnValue(true);
    scholarAccountId.mockResolvedValue(userA);
    scholarBaseline.mockReturnValue({ fileId: 'file-id', versionId });
    const book = makeBook();
    transferManager.pauseQueue();
    const service = await initManager(makeAppService(), [book]);
    await flushAsync(0);
    const id = transferManager.queueUpload(book)!;
    const task = useTransferStore.getState().transfers[id]!;
    expect(task.scholarAccountId).toBe(userA);
    expect(task.scholarExpectedVersionId).toBe(versionId);
    expect(scholarBaseline).toHaveBeenCalledWith(userA, expect.stringContaining('Readest/Books/'));
    transferManager.resumeQueue();
    await flushAsync();
    expect(service['uploadBook']).toHaveBeenCalledWith(book, expect.any(Function), {
      accountId: userA,
      opId: task.scholarOpId,
      expectedVersionId: versionId,
      snapshotPath: `scholar-uploads/${userA}/${task.scholarOpId}`,
    });
  });
  test('accepts an upload after sign-in updates an already initialized manager', async () => {
    scholarRelease.mockReturnValue(true);
    scholarAccountId.mockResolvedValue(null);
    const book = makeBook();
    transferManager.pauseQueue();
    await initManager(makeAppService(), [book]);
    expect(transferManager.queueUpload(book)).toBeNull();

    transferManager.setScholarAccountId(userA);
    const id = transferManager.queueUpload(book);
    expect(id).toBeTruthy();
    expect(useTransferStore.getState().transfers[id!]!.scholarAccountId).toBe(userA);
    transferManager.setScholarAccountId(null);
    expect(transferManager.queueUpload(makeBook({ hash: 'other' }))).toBeNull();
  });

  test('full mirror downloads stay bound to the account that queued them', async () => {
    scholarRelease.mockReturnValue(true);
    scholarAccountId.mockResolvedValue(userA);
    const book = makeBook({ uploadedAt: 1000, downloadedAt: null });
    transferManager.pauseQueue();
    const service = await initManager(makeAppService(), [book]);
    const oldId = transferManager.queueDownload(book, 20, true)!;
    expect(useTransferStore.getState().transfers[oldId]?.scholarAccountId).toBe(userA);

    transferManager.setScholarAccountId(userB);
    scholarAccountId.mockResolvedValue(userB);
    const newId = transferManager.queueDownload(book, 20, true)!;
    expect(newId).not.toBe(oldId);
    expect(useTransferStore.getState().transfers[oldId]?.cancelReason).toBe('policy');
    expect(useTransferStore.getState().transfers[newId]?.scholarAccountId).toBe(userB);
    transferManager.resumeQueue();
    await flushAsync();
    expect(service['downloadBook']).toHaveBeenCalledTimes(1);
    expect(useTransferStore.getState().transfers[newId]?.status).toBe('completed');
  });

  test('opening a book promotes an automatic mirror task to a manual download', async () => {
    scholarRelease.mockReturnValue(true);
    scholarAccountId.mockResolvedValue(userA);
    const book = makeBook({ uploadedAt: 1000, downloadedAt: null });
    transferManager.pauseQueue();
    const service = await initManager(makeAppService(), [book]);
    const id = transferManager.queueDownload(book, 20, true, true)!;
    expect(transferManager.queueDownload(book, 0, false)).toBe(id);
    const task = useTransferStore.getState().transfers[id]!;
    expect(task.scholarMirror).toBe(false);
    expect(task.isBackground).toBe(false);
    expect(task.priority).toBe(0);
    transferManager.stopScholarFullMirror(userA);
    expect(useTransferStore.getState().transfers[id]?.status).toBe('pending');
    transferManager.resumeQueue();
    await flushAsync();
    expect(service['downloadBook']).toHaveBeenCalledTimes(1);
    expect(useTransferStore.getState().transfers[id]?.status).toBe('completed');
  });

  test('full mirror replaces a stale local copy and records the remote timestamp', async () => {
    scholarRelease.mockReturnValue(true);
    scholarAccountId.mockResolvedValue(userA);
    const book = makeBook({ uploadedAt: Date.now() + 1000, downloadedAt: 1 });
    transferManager.pauseQueue();
    const service = await initManager(makeAppService(), [book]);
    const id = transferManager.queueDownload(book, 20, true, true)!;
    transferManager.resumeQueue();
    await flushAsync();
    expect(service['downloadBook']).toHaveBeenCalledWith(book, false, true, expect.any(Function));
    expect(useTransferStore.getState().transfers[id]?.status).toBe('completed');
    expect(book.downloadedAt).toBeGreaterThanOrEqual(book.uploadedAt!);
  });

  test('turning off full mirror cancels only this account automatic downloads', async () => {
    scholarRelease.mockReturnValue(true);
    scholarAccountId.mockResolvedValue(userA);
    const book = makeBook({ uploadedAt: 1000, downloadedAt: null });
    transferManager.pauseQueue();
    await initManager(makeAppService(), [book]);
    const mirrorId = transferManager.queueDownload(book, 20, true, true)!;
    const otherId = useTransferStore
      .getState()
      .addTransfer('other-book', 'Other book', 'download', 10, false, {
        accountId: userA,
        expectedVersionId: null,
      });
    expect(useTransferStore.getState().transfers[mirrorId]?.scholarMirror).toBe(true);
    expect(useTransferStore.getState().transfers[otherId]?.scholarMirror).toBe(false);

    transferManager.stopScholarFullMirror(userA);
    expect(useTransferStore.getState().transfers[mirrorId]?.status).toBe('cancelled');
    expect(useTransferStore.getState().transfers[mirrorId]?.cancelReason).toBe('policy');
    expect(useTransferStore.getState().transfers[otherId]?.status).toBe('pending');
  });

  test('captures a stable delete operation and never invokes the legacy object remover', async () => {
    scholarRelease.mockReturnValue(true);
    scholarAccountId.mockResolvedValue(userA);
    scholarBaseline.mockReturnValue({ fileId: 'file-id', versionId });
    const book = makeBook({ uploadedAt: 1000 });
    transferManager.pauseQueue();
    const service = await initManager(makeAppService(), [book]);
    const id = transferManager.queueDelete(book)!;
    const task = useTransferStore.getState().transfers[id]!;
    expect(task.scholarAccountId).toBe(userA);
    expect(task.scholarOpId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(task.scholarExpectedVersionId).toBe(versionId);
    expect(task.scholarFilePath).toContain('Readest/Books/');
    transferManager.resumeQueue();
    await flushAsync();
    expect(fetchWithAuth).toHaveBeenCalledWith(
      expect.stringContaining('/scholar/files/delete'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          fileName: task.scholarFilePath,
          opId: task.scholarOpId,
          expectedVersionId: versionId,
        }),
      }),
    );
    expect(service['deleteBook']).not.toHaveBeenCalled();
    expect(book.uploadedAt).toBeNull();
    expect(useTransferStore.getState().transfers[id]?.status).toBe('completed');
  });

  test('retains a conflicting remote version without automatic delete replay', async () => {
    scholarRelease.mockReturnValue(true);
    scholarAccountId.mockResolvedValue(userA);
    scholarBaseline.mockReturnValue({ fileId: 'file-id', versionId });
    fetchWithAuth.mockRejectedValueOnce(
      new Error('Scholar delete conflict; remote version retained'),
    );
    const book = makeBook({ uploadedAt: 1000 });
    transferManager.pauseQueue();
    await initManager(makeAppService(), [book]);
    const id = transferManager.queueDelete(book)!;
    transferManager.resumeQueue();
    await flushAsync();
    expect(useTransferStore.getState().transfers[id]?.status).toBe('failed');
    expect(book.uploadedAt).toBe(1000);
    transferManager.retryAllFailed();
    await flushAsync();
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
  });

  test('keeping a changed cloud file cancels delete and restores a local tombstone', async () => {
    scholarRelease.mockReturnValue(true);
    scholarAccountId.mockResolvedValue(userA);
    const book = makeBook({ deletedAt: 1000, downloadedAt: null, uploadedAt: 900 });
    const updateBook = vi.fn().mockResolvedValue(undefined);
    await transferManager.initialize(
      makeAppService() as never,
      () => [book],
      updateBook,
      translationFn,
    );
    const task = makeTransferItem({
      id: 'delete-conflict',
      type: 'delete',
      status: 'failed',
      scholarAccountId: userA,
      scholarFilePath: 'Readest/Books/hash1/Test Book.epub',
      scholarOpId: '00000000-0000-4000-8000-000000000004',
      scholarExpectedVersionId: versionId,
      error: 'Scholar delete conflict; remote version retained',
    });
    useTransferStore.setState({ transfers: { [task.id]: task } });
    await transferManager.keepScholarCloudAfterDeleteConflict(task.id, 'file-id', versionId);
    expect(fetchWithAuth).toHaveBeenCalledWith(
      expect.stringContaining('/scholar/files/restore'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ fileId: 'file-id', versionId, expectedVersionId: versionId }),
      }),
    );
    expect(updateBook).toHaveBeenCalledWith(
      expect.objectContaining({
        deletedAt: null,
        fileSyncDeletionRequestedAt: null,
        uploadedAt: 900,
      }),
    );
    expect(saveScholarBaseline).toHaveBeenCalledWith(userA, task.scholarFilePath, {
      fileId: 'file-id',
      versionId,
    });
    expect(useTransferStore.getState().transfers[task.id]).toBeUndefined();
    expect(useTransferStore.getState().getQueueStats().failed).toBe(0);
  });

  test('reviewed delete retry gets a fresh operation ID and current head', async () => {
    scholarRelease.mockReturnValue(true);
    scholarAccountId.mockResolvedValue(userA);
    scholarBaseline.mockReturnValue({ fileId: 'file-id', versionId });
    transferManager.pauseQueue();
    await initManager(makeAppService(), [makeBook()]);
    const task = makeTransferItem({
      id: 'delete-conflict',
      type: 'delete',
      status: 'failed',
      scholarAccountId: userA,
      scholarFilePath: 'Readest/Books/hash1/Test Book.epub',
      scholarOpId: '00000000-0000-4000-8000-000000000004',
      scholarExpectedVersionId: versionId,
      error: 'Scholar delete conflict; remote version retained',
    });
    useTransferStore.setState({ transfers: { [task.id]: task } });
    const newHead = '00000000-0000-4000-8000-000000000005';
    await transferManager.requeueScholarDeleteConflict(task.id, 'file-id', newHead);
    const rebased = useTransferStore.getState().transfers[task.id]!;
    expect(rebased.status).toBe('pending');
    expect(rebased.scholarExpectedVersionId).toBe(newHead);
    expect(rebased.scholarOpId).not.toBe(task.scholarOpId);
    expect(rebased.error).toBeUndefined();
  });

  test('stages the body even when paused, and reuses its path after the source changes', async () => {
    scholarRelease.mockReturnValue(true);
    scholarAccountId.mockResolvedValue(userA);
    const book = makeBook();
    transferManager.pauseQueue();
    const service = await initManager(makeAppService(), [book]);
    const id = transferManager.queueUpload(book)!;
    await flushAsync(0);
    const task = useTransferStore.getState().transfers[id]!;
    expect(service['createScholarUploadSnapshot']).toHaveBeenCalledWith(
      book,
      task.scholarSnapshotPath,
    );
    expect(service['uploadBook']).not.toHaveBeenCalled();
    book.filePath = '/changed-source.pdf';
    transferManager.resumeQueue();
    await flushAsync();
    expect(service['uploadBook']).toHaveBeenCalledWith(
      book,
      expect.any(Function),
      expect.objectContaining({ snapshotPath: task.scholarSnapshotPath, opId: task.scholarOpId }),
    );
    expect(service['deleteFile']).toHaveBeenCalledWith(task.scholarSnapshotPath, 'Cache');
  });

  test('a restored Scholar task reads its persisted snapshot and operation ID', async () => {
    scholarRelease.mockReturnValue(true);
    scholarAccountId.mockResolvedValue(userA);
    const book = makeBook();
    transferManager.pauseQueue();
    await initManager(makeAppService(), [book]);
    const id = transferManager.queueUpload(book)!;
    await flushAsync(0);
    const task = useTransferStore.getState().transfers[id]!;
    const saved = localStorage.getItem('readest_transfer_queue')!;
    resetTransferManager();
    resetTransferStore();
    localStorage.setItem('readest_transfer_queue', saved);
    const service = await initManager(makeAppService(), [book]);
    expect(service['createScholarUploadSnapshot']).not.toHaveBeenCalled();
    transferManager.resumeQueue();
    await flushAsync();
    expect(service['uploadBook']).toHaveBeenCalledWith(
      book,
      expect.any(Function),
      expect.objectContaining({ snapshotPath: task.scholarSnapshotPath, opId: task.scholarOpId }),
    );
  });

  test('missing restored snapshot fails without using the operation ID', async () => {
    scholarRelease.mockReturnValue(true);
    scholarAccountId.mockResolvedValue(userA);
    const book = makeBook();
    transferManager.pauseQueue();
    await initManager(makeAppService(), [book]);
    const id = transferManager.queueUpload(book)!;
    await flushAsync(0);
    const saved = localStorage.getItem('readest_transfer_queue')!;
    resetTransferManager();
    resetTransferStore();
    localStorage.setItem('readest_transfer_queue', saved);
    const service = await initManager(
      makeAppService({ exists: vi.fn().mockResolvedValue(false) }),
      [book],
    );
    transferManager.resumeQueue();
    await flushAsync();
    expect(service['uploadBook']).not.toHaveBeenCalled();
    expect(useTransferStore.getState().transfers[id]?.status).toBe('failed');
    expect(useTransferStore.getState().transfers[id]?.retryCount).toBe(0);
  });

  test('staging failure fails the task without a network call', async () => {
    scholarRelease.mockReturnValue(true);
    scholarAccountId.mockResolvedValue(userA);
    const book = makeBook();
    const service = await initManager(
      makeAppService({
        createScholarUploadSnapshot: vi.fn().mockRejectedValue(new Error('disk full')),
      }),
      [book],
    );
    const id = transferManager.queueUpload(book)!;
    await flushAsync();
    expect(service['uploadBook']).not.toHaveBeenCalled();
    expect(useTransferStore.getState().transfers[id]?.status).toBe('failed');
    expect(useTransferStore.getState().transfers[id]?.error).toBe('disk full');
  });

  test('clearing a paused task removes its staged copy', async () => {
    scholarRelease.mockReturnValue(true);
    scholarAccountId.mockResolvedValue(userA);
    const book = makeBook();
    transferManager.pauseQueue();
    const service = await initManager(makeAppService(), [book]);
    const id = transferManager.queueUpload(book)!;
    await flushAsync(0);
    const path = useTransferStore.getState().transfers[id]!.scholarSnapshotPath;
    transferManager.clearPending();
    expect(service['deleteFile']).toHaveBeenCalledWith(path, 'Cache');
    expect(useTransferStore.getState().transfers[id]).toBeUndefined();
  });

  test('keeps a CAS conflict failed without repeating the same rejected operation', async () => {
    scholarRelease.mockReturnValue(true);
    scholarAccountId.mockResolvedValue(userA);
    const book = makeBook();
    transferManager.pauseQueue();
    const service = await initManager(
      makeAppService({
        uploadBook: vi
          .fn()
          .mockRejectedValue(new Error('Scholar file conflict; local version retained')),
      }),
      [book],
    );
    await flushAsync(0);
    const id = transferManager.queueUpload(book)!;
    transferManager.resumeQueue();
    await flushAsync();
    expect(service['uploadBook']).toHaveBeenCalledTimes(1);
    expect(useTransferStore.getState().transfers[id]?.status).toBe('failed');
    expect(useTransferStore.getState().transfers[id]?.retryCount).toBe(0);
  });

  test('does not send an old account queued book under a new account', async () => {
    scholarRelease.mockReturnValue(true);
    scholarAccountId.mockResolvedValue(userA);
    const book = makeBook();
    transferManager.pauseQueue();
    const service = await initManager(makeAppService(), [book]);
    await flushAsync(0);
    transferManager.queueUpload(book);
    scholarAccountId.mockResolvedValue(userB);
    transferManager.resumeQueue();
    await flushAsync();
    expect(service['uploadBook']).not.toHaveBeenCalled();
  });
});

describe('provider gating of book uploads', () => {
  test('queueUpload returns null and queues nothing when a third-party provider is selected', async () => {
    webdavSelected();
    await initManager();

    const id = transferManager.queueUpload(makeBook());
    expect(id).toBeNull();
    expect(Object.keys(useTransferStore.getState().transfers)).toHaveLength(0);
  });

  test('queueUpload works when Readest Cloud is the provider', async () => {
    await initManager();

    const id = transferManager.queueUpload(makeBook());
    expect(id).toBeTruthy();
  });

  test('queueBatchUploads returns empty when gated', async () => {
    webdavSelected();
    await initManager();

    const ids = transferManager.queueBatchUploads([makeBook(), makeBook({ hash: 'hash2' })]);
    expect(ids).toEqual([]);
  });

  test('downloads and replica transfers are never gated', async () => {
    webdavSelected();
    await initManager();

    const downloadId = transferManager.queueDownload(makeBook());
    expect(downloadId).toBeTruthy();

    const replicaId = transferManager.queueReplicaUpload(
      'font',
      'font-1',
      'A Font',
      [{ logical: 'font.ttf', lfp: '/tmp/font.ttf', byteSize: 10 }],
      'Data' as never,
    );
    expect(replicaId).toBeTruthy();
  });
});

describe('Books sync category gating of book uploads', () => {
  // A cloud file is only reachable through its `books` row, and that row is
  // pushed only while Books sync is on. Uploading with it off stored files
  // that no other device could ever list, while still spending quota.
  test('queueUpload returns null when Books sync is off', async () => {
    booksSyncOff();
    await initManager();

    const id = transferManager.queueUpload(makeBook());
    expect(id).toBeNull();
    expect(Object.keys(useTransferStore.getState().transfers)).toHaveLength(0);
  });

  test('turning Books sync off policy-cancels pending book uploads', async () => {
    await initManager();
    useTransferStore.getState().pauseQueue();
    const id = transferManager.queueUpload(makeBook())!;

    booksSyncOff();
    await flushAsync();

    const transfer = useTransferStore.getState().transfers[id];
    expect(transfer?.status).toBe('cancelled');
    expect(transfer?.cancelReason).toBe('policy');
  });

  test('isBookUploadAllowed reflects the Books sync category', () => {
    settingsLoaded();
    expect(transferManager.isBookUploadAllowed()).toBe(true);
    booksSyncOff();
    expect(transferManager.isBookUploadAllowed()).toBe(false);
  });
});

describe('ABS books never enter the cloud file transfer queue', () => {
  test('queueUpload returns null for an ABS book even with Readest Cloud selected', async () => {
    await initManager();

    const id = transferManager.queueUpload(makeBook({ format: 'ABS' }));
    expect(id).toBeNull();
    expect(Object.keys(useTransferStore.getState().transfers)).toHaveLength(0);
  });

  test('queueDownload returns null for an ABS book', async () => {
    await initManager();

    const id = transferManager.queueDownload(makeBook({ format: 'ABS' }));
    expect(id).toBeNull();
    expect(Object.keys(useTransferStore.getState().transfers)).toHaveLength(0);
  });

  test('queueBatchUploads drops ABS books but still queues the rest', async () => {
    await initManager();

    const ids = transferManager.queueBatchUploads([
      makeBook({ format: 'ABS' }),
      makeBook({ hash: 'hash2' }),
    ]);
    expect(ids).toHaveLength(1);
  });
});

describe('settings-loaded barrier', () => {
  test('a pending book upload does not execute before settings hydration', async () => {
    settingsNotLoaded();
    const persisted = {
      transfers: { t1: makeTransferItem() },
      isQueuePaused: false,
    };
    localStorage.setItem('readest_transfer_queue', JSON.stringify(persisted));

    const appService = makeAppService();
    await initManager(appService, [makeBook()]);
    await flushAsync();

    expect(appService['uploadBook']).not.toHaveBeenCalled();
    expect(useTransferStore.getState().transfers['t1']?.status).toBe('pending');
  });

  test('the deferred upload executes once settings hydrate with readest selected', async () => {
    settingsNotLoaded();
    localStorage.setItem(
      'readest_transfer_queue',
      JSON.stringify({ transfers: { t1: makeTransferItem() }, isQueuePaused: false }),
    );

    const appService = makeAppService();
    await initManager(appService, [makeBook()]);
    await flushAsync();
    expect(appService['uploadBook']).not.toHaveBeenCalled();

    settingsLoaded();
    await flushAsync();

    expect(appService['uploadBook']).toHaveBeenCalledTimes(1);
  });

  test('replica transfers are not stalled by the barrier', async () => {
    settingsNotLoaded();
    const appService = makeAppService();
    await initManager(appService);

    transferManager.queueReplicaDownload(
      'font',
      'font-1',
      'A Font',
      [{ logical: 'font.ttf', lfp: '/tmp/font.ttf', byteSize: 10 }],
      'Data' as never,
    );
    await flushAsync();

    expect(appService['downloadReplicaFile']).toHaveBeenCalled();
  });
});

describe('policy cancellation on restore/reconcile', () => {
  test('pre-switch pending book uploads are policy-cancelled on restore; downloads and replicas survive', async () => {
    webdavSelected();
    const persisted = {
      transfers: {
        up1: makeTransferItem({ id: 'up1' }),
        down1: makeTransferItem({ id: 'down1', type: 'download', bookHash: 'hash2' }),
        rep1: makeTransferItem({
          id: 'rep1',
          kind: 'replica',
          type: 'upload',
          bookHash: '',
          replicaKind: 'font',
          replicaId: 'font-1',
          replicaFiles: [{ logical: 'font.ttf', lfp: '/tmp/font.ttf', byteSize: 10 }],
          replicaBase: 'Data' as never,
        }),
      },
      isQueuePaused: true,
    };
    localStorage.setItem('readest_transfer_queue', JSON.stringify(persisted));

    await initManager();
    await flushAsync();

    const transfers = useTransferStore.getState().transfers;
    expect(transfers['up1']?.status).toBe('cancelled');
    expect(transfers['up1']?.cancelReason).toBe('policy');
    expect(transfers['down1']?.status).toBe('pending');
    expect(transfers['rep1']?.status).toBe('pending');
  });

  test('switching providers after init policy-cancels pending book uploads', async () => {
    await initManager();
    useTransferStore.getState().pauseQueue();
    const id = transferManager.queueUpload(makeBook())!;

    webdavSelected();
    await flushAsync();

    const transfer = useTransferStore.getState().transfers[id];
    expect(transfer?.status).toBe('cancelled');
    expect(transfer?.cancelReason).toBe('policy');
  });

  test('policy-cancelled rows from a previous session are pruned on restore', async () => {
    const persisted = {
      transfers: {
        old1: makeTransferItem({ id: 'old1', status: 'cancelled', cancelReason: 'policy' }),
        user1: makeTransferItem({ id: 'user1', status: 'cancelled' }),
      },
      isQueuePaused: false,
    };
    localStorage.setItem('readest_transfer_queue', JSON.stringify(persisted));

    await initManager();

    const transfers = useTransferStore.getState().transfers;
    expect(transfers['old1']).toBeUndefined();
    expect(transfers['user1']).toBeDefined();
  });

  test('legacy persisted entries without kind or cancelReason restore cleanly', async () => {
    const legacy = makeTransferItem({ id: 'l1', status: 'completed' }) as Partial<TransferItem>;
    delete legacy.kind;
    localStorage.setItem(
      'readest_transfer_queue',
      JSON.stringify({ transfers: { l1: legacy }, isQueuePaused: false }),
    );

    await initManager();

    const restored = useTransferStore.getState().transfers['l1'];
    expect(restored?.kind).toBe('book');
    expect(restored?.status).toBe('completed');
  });
});

describe('cancelled bucket accounting', () => {
  test('policy-cancelled rows are excluded from failed stats and getFailedTransfers; user-cancelled stay', () => {
    useTransferStore.setState({
      transfers: {
        p1: makeTransferItem({ id: 'p1', status: 'cancelled', cancelReason: 'policy' }),
        u1: makeTransferItem({ id: 'u1', status: 'cancelled', cancelReason: 'user' }),
        f1: makeTransferItem({ id: 'f1', status: 'failed' }),
      },
    });

    const store = useTransferStore.getState();
    const failedIds = store.getFailedTransfers().map((t) => t.id);
    expect(failedIds).toContain('u1');
    expect(failedIds).toContain('f1');
    expect(failedIds).not.toContain('p1');
    expect(store.getQueueStats().failed).toBe(2);
  });

  test('retryAllFailed does not resurrect policy-cancelled rows', async () => {
    webdavSelected();
    await initManager();
    useTransferStore.setState({
      transfers: {
        p1: makeTransferItem({ id: 'p1', status: 'cancelled', cancelReason: 'policy' }),
      },
    });

    transferManager.retryAllFailed();
    await flushAsync();

    expect(useTransferStore.getState().transfers['p1']?.status).toBe('cancelled');
  });

  test('retryTransfer no-ops on a policy-cancelled row', async () => {
    webdavSelected();
    await initManager();
    useTransferStore.setState({
      transfers: {
        p1: makeTransferItem({ id: 'p1', status: 'cancelled', cancelReason: 'policy' }),
      },
    });

    transferManager.retryTransfer('p1');
    await flushAsync();

    expect(useTransferStore.getState().transfers['p1']?.status).toBe('cancelled');
  });

  test('user cancelTransfer records cancelReason user', async () => {
    await initManager();
    useTransferStore.getState().pauseQueue();
    const id = transferManager.queueUpload(makeBook())!;

    transferManager.cancelTransfer(id);

    const transfer = useTransferStore.getState().transfers[id];
    expect(transfer?.status).toBe('cancelled');
    expect(transfer?.cancelReason).toBe('user');
  });

  test('gate-off reconcile settles: a force-pended policy row is re-cancelled without looping', async () => {
    webdavSelected();
    await initManager();
    useTransferStore.setState({
      transfers: {
        p1: makeTransferItem({ id: 'p1', status: 'pending', cancelReason: 'policy' }),
      },
    });

    await (transferManager as unknown as { processQueue: () => Promise<void> }).processQueue();
    await flushAsync();

    const transfer = useTransferStore.getState().transfers['p1'];
    expect(transfer?.status).toBe('cancelled');
    expect(useTransferStore.getState().getPendingTransfers()).toHaveLength(0);
  });
});

describe('quota failure handling', () => {
  test('quota 403 fails immediately with zero retries', async () => {
    const appService = makeAppService({
      uploadBook: vi.fn().mockRejectedValue(new Error('Insufficient storage quota')),
    });
    const book = makeBook();
    await initManager(appService, [book]);

    transferManager.queueUpload(book);
    await flushAsync();

    const transfers = Object.values(useTransferStore.getState().transfers);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]?.status).toBe('failed');
    expect(transfers[0]?.retryCount).toBe(0);
    expect(appService['uploadBook']).toHaveBeenCalledTimes(1);
  });

  test('a batch of quota failures produces one summary toast, not one per book', async () => {
    const appService = makeAppService({
      uploadBook: vi.fn().mockRejectedValue(new Error('Insufficient storage quota')),
    });
    const books = [makeBook(), makeBook({ hash: 'hash2' }), makeBook({ hash: 'hash3' })];
    await initManager(appService, books);

    transferManager.queueBatchUploads(books);
    await flushAsync(10000);

    const dispatched = vi.mocked(eventDispatcher.dispatch).mock.calls.filter(
      ([event, payload]) =>
        event === 'toast' &&
        String((payload as { message?: string })?.message ?? '')
          .toLowerCase()
          .includes('quota'),
    );
    expect(dispatched).toHaveLength(1);
    expect(String((dispatched[0]![1] as { message: string }).message)).toContain('3');
  });

  test('non-quota errors keep the existing retry behavior', async () => {
    const appService = makeAppService({
      uploadBook: vi.fn().mockRejectedValue(new Error('network boom')),
    });
    const book = makeBook();
    await initManager(appService, [book]);

    transferManager.queueUpload(book);
    await flushAsync(60000);

    const transfer = Object.values(useTransferStore.getState().transfers)[0];
    expect(transfer?.status).toBe('failed');
    expect(transfer?.retryCount).toBe(3);
  });
});

describe('Scholar conflict completion', () => {
  const accountId = '00000000-0000-4000-8000-000000000001';
  const fileId = '00000000-0000-4000-8000-000000000002';
  const versionId = '00000000-0000-4000-8000-000000000003';

  test('publishing the verified local version closes the queue item and deletes its snapshot', async () => {
    scholarAccountId.mockResolvedValue(accountId);
    const book = makeBook();
    const service = await initManager(makeAppService(), [book]);
    useTransferStore.setState({
      transfers: {
        t1: makeTransferItem({
          status: 'failed',
          error: 'Scholar file conflict; local version retained',
          scholarAccountId: accountId,
          scholarOpId: 'op-1',
          scholarSnapshotPath: 'scholar-uploads/snapshot',
        }),
      },
    });
    await transferManager.finishScholarConflict('t1', fileId, versionId, true);
    expect(saveScholarBaseline).toHaveBeenCalledWith(
      accountId,
      expect.stringContaining('Readest/Books/'),
      { fileId, versionId },
    );
    expect(book.uploadedAt).toEqual(expect.any(Number));
    expect(useTransferStore.getState().transfers['t1']?.status).toBe('completed');
    expect(service['deleteFile']).toHaveBeenCalledWith('scholar-uploads/snapshot', 'Cache');
  });

  test('an account switch leaves the conflict and its local snapshot intact', async () => {
    scholarAccountId.mockResolvedValue('00000000-0000-4000-8000-000000000004');
    const service = await initManager(makeAppService(), [makeBook()]);
    useTransferStore.setState({
      transfers: {
        t1: makeTransferItem({
          status: 'failed',
          error: 'Scholar file conflict; local version retained',
          scholarAccountId: accountId,
          scholarOpId: 'op-1',
          scholarSnapshotPath: 'scholar-uploads/snapshot',
        }),
      },
    });
    await expect(
      transferManager.finishScholarConflict('t1', fileId, versionId, false),
    ).rejects.toThrow('Scholar upload account changed');
    expect(saveScholarBaseline).not.toHaveBeenCalled();
    expect(useTransferStore.getState().transfers['t1']?.status).toBe('failed');
    expect(service['deleteFile']).not.toHaveBeenCalled();
  });
});
