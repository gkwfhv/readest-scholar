import { Book } from '@/types/book';
import { AppService, BaseDir, type ScholarFileUploadContext } from '@/types/system';
import { isScholarReleaseBundle, isScholarTestBundle, getAPIBaseUrl } from '@/services/environment';
import { fetchWithAuth } from '@/utils/fetch';
import { getRemoteBookFilename } from '@/utils/book';
import { CLOUD_BOOKS_SUBDIR } from '@/services/constants';
import { getScholarAccountId, getScholarFileBaseline, saveScholarFileBaseline } from '@/services/scholarFileBaseline';
import { useTransferStore, isRetryableTransfer, TransferItem, ReplicaTransferFile } from '@/store/transferStore';
import { useSettingsStore } from '@/store/settingsStore';
import { isReadestCloudStorageActive } from '@/services/sync/cloudSyncProvider';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import { TranslationFunc } from '@/hooks/useTranslation';
import { createProgressThrottle, ProgressHandler, ProgressPayload } from '@/utils/transfer';
import { eventDispatcher } from '@/utils/event';
import { isAbsOfflineCapable, isAudiobook } from '@/utils/audiobook';
import { getTransferMessages } from './transferMessages';

const TRANSFER_QUEUE_KEY = 'readest_transfer_queue';
const RETRY_DELAY_BASE_MS = 2000;
// Coalesce per-chunk progress emissions to at most ~10/sec per transfer so the
// transfer-store fan-out cannot sustain a synchronous React update storm (a
// buffered download emits progress once per chunk in a microtask burst, and
// transferSpeed changes every call so the store's no-op guard cannot help)
// (Sentry READEST-2).
const PROGRESS_THROTTLE_MS = 100;
// Quota failures in a batch import arrive one per book as transfers drain;
// collapse them into one summary toast per burst instead of N identical toasts.
const QUOTA_TOAST_FLUSH_MS = 1500;

interface PersistedQueueData {
  schemaVersion?: number;
  transfers: Record<string, TransferItem>;
  isQueuePaused: boolean;
}

const QUEUE_SCHEMA_VERSION = 1;

class TransferManager {
  private static instance: TransferManager;
  private appService: AppService | null = null;
  private isProcessing = false;
  private processRequested = false;
  private abortControllers: Map<string, AbortController> = new Map();
  private isInitialized = false;
  private scholarAccountId: string | null = null;
  private getLibrary: (() => Book[]) | null = null;
  private updateBook: ((book: Book) => Promise<void>) | null = null;
  private _: TranslationFunc | null = null;
  private settingsUnsub: (() => void) | null = null;
  private quotaFailureCount = 0;
  private quotaToastTimer: ReturnType<typeof setTimeout> | null = null;
  private readyResolve: () => void = () => {};
  private readyPromise: Promise<void> = new Promise<void>((resolve) => {
    this.readyResolve = resolve;
  });

  private constructor() {}

  /**
   * Settings hydrate asynchronously at app start (`settings` begins as
   * `{}`); `settings.version` truthiness is the loaded signal (same
   * convention as useSync). Before hydration the provider is unknown, so
   * book uploads are deferred rather than judged — acting on unknown
   * settings could both mis-cancel and mis-allow. Replica transfers and
   * downloads are never deferred: they are not provider-gated and the
   * boot-time replica pull relies on waitUntilReady().
   */
  private isSettingsLoaded(): boolean {
    return !!useSettingsStore.getState().settings?.version;
  }

  /**
   * A Readest Cloud file is only reachable through its `books` row, and that
   * row is pushed only while Books sync is on. Uploading with it off stores
   * files no other device can ever list, while still spending quota.
   */
  isBookUploadAllowed(): boolean {
    return (
      isReadestCloudStorageActive(useSettingsStore.getState().settings) &&
      isSyncCategoryEnabled('book')
    );
  }

  private isDeferredBookUpload(t: TransferItem): boolean {
    return t.kind === 'book' && t.type === 'upload' && !this.isSettingsLoaded();
  }

  /**
   * Cancel pending book uploads when Readest Cloud is not the selected
   * provider or Books sync is off. Idempotent (acts on pending rows only) — safe to run on
   * every processQueue pass, which also re-settles rows another window
   * or a rogue retry re-pended. Cancellation is visible ('cancelled'
   * with cancelReason 'policy'), never a silent drop.
   */
  private reconcileUploadsWithProvider(): void {
    if (!this.isSettingsLoaded() || this.isBookUploadAllowed()) return;

    const store = useTransferStore.getState();
    const gated = store
      .getPendingTransfers()
      .filter((t) => t.kind === 'book' && t.type === 'upload');
    if (gated.length === 0) return;

    gated.forEach((t) => {
      store.setTransferStatus(t.id, 'cancelled', undefined, 'policy');
    });
    this.cleanupScholarSnapshots(gated);
    console.info(
      `[cloudSync] cancelled ${gated.length} pending Readest Cloud upload(s): Readest Cloud or Books sync is off`,
    );
    this.persistQueue();
  }

  static getInstance(): TransferManager {
    if (!TransferManager.instance) {
      TransferManager.instance = new TransferManager();
    }
    return TransferManager.instance;
  }

  async initialize(
    appService: AppService,
    getLibrary: () => Book[],
    updateBook: (book: Book) => Promise<void>,
    translationFn: TranslationFunc,
  ): Promise<void> {
    if (this.isInitialized) return;

    this.appService = appService;
    this.getLibrary = getLibrary;
    this.updateBook = updateBook;
    this._ = translationFn;
    this.scholarAccountId = (isScholarReleaseBundle() || isScholarTestBundle()) ? await getScholarAccountId() : null;
    await this.loadPersistedQueue();
    this.failUnstagedScholarTransfers();
    this.reconcileUploadsWithProvider();
    this.isInitialized = true;
    this.readyResolve();

    // Re-gate when settings hydrate or the selected provider changes.
    this.settingsUnsub?.();
    this.settingsUnsub = useSettingsStore.subscribe((state, prev) => {
      if (state.settings === prev.settings) return;
      this.reconcileUploadsWithProvider();
      this.processQueue();
    });

    // Start processing queue
    this.processQueue();
  }

  /** Keep upload queue ownership aligned with the live auth session. */
  setScholarAccountId(accountId: string | null): void {
    if (!(isScholarReleaseBundle() || isScholarTestBundle())) return;
    this.scholarAccountId = accountId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)
      ? accountId
      : null;
  }

  isReady(): boolean {
    return this.isInitialized && this.appService !== null;
  }

  /**
   * Resolves once `initialize()` has completed. Lets callers that need
   * to enqueue transfers (e.g., the boot-time replica pull) defer until
   * the manager is wired up — the manager only inits after the library
   * is loaded, which can lag well behind app boot.
   */
  waitUntilReady(): Promise<void> {
    return this.readyPromise;
  }

  queueUpload(book: Book, priority: number = 10): string | null {
    if (!this.isReady()) {
      console.warn('TransferManager not initialized');
      return null;
    }

    // ABS books stream from the server; there is no local file to upload.
    if (isAudiobook(book)) return null;

    // Readest Cloud storage is not written to while a third-party
    // provider is selected. Before settings hydrate the entry is queued
    // and deferred; the reconcile on hydration decides its fate.
    if (this.isSettingsLoaded() && !this.isBookUploadAllowed()) {
      return null;
    }

    const store = useTransferStore.getState();

    // Check if already queued or in progress
    const existing = store.getTransferByBookHash(book.hash, 'upload');
    if (existing) {
      return existing.id;
    }

    let scholar: { accountId: string; expectedVersionId: string | null } | undefined;
    if ((isScholarReleaseBundle() || isScholarTestBundle())) {
      if (!this.scholarAccountId) return null;
      const cfp = `${CLOUD_BOOKS_SUBDIR}/${getRemoteBookFilename(book)}`;
      scholar = {
        accountId: this.scholarAccountId,
        expectedVersionId: getScholarFileBaseline(this.scholarAccountId, cfp)?.versionId ?? null,
      };
    }
    const transferId = store.addTransfer(book.hash, book.title, 'upload', priority, false, scholar);
    this.persistQueue();
    if (scholar) void this.stageScholarSnapshot(transferId, book);
    this.processQueue();
    return transferId;
  }

  private async stageScholarSnapshot(id: string, book: Book): Promise<void> {
    const task = useTransferStore.getState().transfers[id];
    if (!task?.scholarOpId || !task.scholarAccountId || !this.appService) return;
    const path = `scholar-uploads/${task.scholarAccountId}/${task.scholarOpId}`;
    await (async () => {
      try {
        await this.appService!.createScholarUploadSnapshot(book, path);
        const current = useTransferStore.getState().transfers[id];
        if (!current || current.status !== 'pending') {
          await this.appService!.deleteFile(path, 'Cache').catch(() => {});
          return;
        }
        useTransferStore.getState().setScholarSnapshotPath(id, path);
        this.persistQueue();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Scholar upload snapshot failed';
        useTransferStore.getState().setTransferStatus(id, 'failed', message);
        this.persistQueue();
      } finally {
        this.processQueue();
      }
    })();
  }

  private failUnstagedScholarTransfers(): void {
    const store = useTransferStore.getState();
    for (const task of Object.values(store.transfers)) {
      if (task.kind === 'book' && task.type === 'upload' && task.scholarAccountId &&
          task.status === 'pending' && !task.scholarSnapshotPath) {
        store.setTransferStatus(task.id, 'failed',
          'Scholar upload snapshot unavailable after restart; requeue');
        if (task.scholarOpId) {
          const partial = `scholar-uploads/${task.scholarAccountId}/${task.scholarOpId}`;
          void this.appService?.deleteFile(partial, 'Cache').catch(() => {});
        }
      }
    }
    this.persistQueue();
  }

  private cleanupScholarSnapshots(tasks: TransferItem[]): void {
    for (const task of tasks) {
      const path = task.scholarSnapshotPath;
      if (path) {
        void this.appService?.deleteFile(path, 'Cache').catch(() => {});
        useTransferStore.getState().setScholarSnapshotPath(task.id, undefined);
      }
    }
  }

  queueDownload(book: Book, priority: number = 10, isBackground: boolean = false, scholarMirror = false): string | null {
    if (!this.isReady()) {
      console.warn('TransferManager not initialized');
      return null;
    }

    // ABS books stream from the server; there is no cloud file to download.
    if (isAudiobook(book)) return null;

    const store = useTransferStore.getState();
    const scholar = isScholarReleaseBundle() || isScholarTestBundle()
      ? this.scholarAccountId ? { accountId: this.scholarAccountId, expectedVersionId: null, mirror: scholarMirror } : null
      : undefined;
    if (scholar === null) return null;

    const existing = store.getTransferByBookHash(book.hash, 'download');
    if (existing) {
      if (!scholar || existing.scholarAccountId === scholar.accountId) {
        // Opening a book turns an automatic mirror transfer into a user request.
        // A later switch to on-demand must not cancel the reader's download.
        if (scholar && !scholarMirror && !isBackground && existing.scholarMirror) {
          store.promoteScholarMirrorDownload(existing.id, priority);
          this.persistQueue();
        }
        return existing.id;
      }
      this.abortControllers.get(existing.id)?.abort();
      store.setTransferStatus(existing.id, 'cancelled', undefined, 'policy');
    }

    const transferId = store.addTransfer(book.hash, book.title, 'download', priority, isBackground, scholar);
    this.persistQueue();
    this.processQueue();
    return transferId;
  }

  /** Stop unfinished automatic mirror downloads when this account opts out. */
  stopScholarFullMirror(accountId: string): void {
    const store = useTransferStore.getState();
    let changed = false;
    for (const task of Object.values(store.transfers)) {
      if (!task.scholarMirror || task.scholarAccountId !== accountId ||
          !['pending', 'in_progress'].includes(task.status)) continue;
      this.abortControllers.get(task.id)?.abort();
      store.setTransferStatus(task.id, 'cancelled', undefined, 'policy');
      changed = true;
    }
    if (changed) this.persistQueue();
  }

  /**
   * Queue an offline download of an Audiobookshelf book's media (#6256). A
   * 'book' download row, so the shelf's cover overlay and the Transfer Queue
   * track it like any book download; executeBookTransfer routes it to the
   * ABS downloader instead of cloud storage.
   */
  queueAbsOfflineDownload(book: Book, priority: number = 10): string | null {
    if (!this.isReady()) {
      console.warn('TransferManager not initialized');
      return null;
    }
    if (!isAbsOfflineCapable(book)) return null;

    const store = useTransferStore.getState();
    const existing = store.getTransferByBookHash(book.hash, 'download');
    if (existing) {
      return existing.id;
    }

    const transferId = store.addTransfer(book.hash, book.title, 'download', priority);
    this.persistQueue();
    this.processQueue();
    return transferId;
  }

  queueDelete(book: Book, priority: number = 10, isBackground: boolean = false): string | null {
    if (!this.isReady()) {
      console.warn('TransferManager not initialized');
      return null;
    }

    const store = useTransferStore.getState();

    const existing = store.getTransferByBookHash(book.hash, 'delete');
    if (existing) {
      return existing.id;
    }

    let scholar: { accountId: string; expectedVersionId: string | null; filePath: string } | undefined;
    if (isScholarReleaseBundle() || isScholarTestBundle()) {
      if (!this.scholarAccountId) return null;
      const filePath = CLOUD_BOOKS_SUBDIR + '/' + getRemoteBookFilename(book);
      scholar = {
        accountId: this.scholarAccountId,
        expectedVersionId: getScholarFileBaseline(this.scholarAccountId, filePath)?.versionId ?? null,
        filePath,
      };
    }
    const transferId = store.addTransfer(book.hash, book.title, 'delete', priority, isBackground, scholar);
    this.persistQueue();
    this.processQueue();
    return transferId;
  }

  queueBatchUploads(books: Book[], priority: number = 10): string[] {
    return books
      .map((book) => this.queueUpload(book, priority))
      .filter((id): id is string => id !== null);
  }

  queueReplicaUpload(
    replicaKind: string,
    replicaId: string,
    displayTitle: string,
    files: ReplicaTransferFile[],
    base: BaseDir,
    opts: { priority?: number; isBackground?: boolean; reincarnation?: string } = {},
  ): string | null {
    if (!this.isReady()) {
      console.warn('TransferManager not initialized');
      return null;
    }
    const store = useTransferStore.getState();
    const existing = store.getReplicaTransfer(replicaKind, replicaId, 'upload');
    if (existing) return existing.id;

    const id = store.addReplicaTransfer(replicaKind, replicaId, displayTitle, 'upload', {
      priority: opts.priority,
      // Replica transfers are background sync by default — see the note on
      // queueReplicaDownload.
      isBackground: opts.isBackground ?? true,
      files,
      base,
      reincarnation: opts.reincarnation,
    });
    this.persistQueue();
    this.processQueue();
    return id;
  }

  queueReplicaDownload(
    replicaKind: string,
    replicaId: string,
    displayTitle: string,
    files: ReplicaTransferFile[],
    base: BaseDir,
    opts: { priority?: number; isBackground?: boolean } = {},
  ): string | null {
    if (!this.isReady()) {
      console.warn('TransferManager not initialized');
      return null;
    }
    const store = useTransferStore.getState();
    const existing = store.getReplicaTransfer(replicaKind, replicaId, 'download');
    if (existing) return existing.id;

    const id = store.addReplicaTransfer(replicaKind, replicaId, displayTitle, 'download', {
      priority: opts.priority,
      // Replica bundles (fonts, textures, dictionaries, OPDS catalogs) sync on
      // their own schedule, not because the user asked for this file right
      // now. Toasting each one turns a fresh device into a wall of
      // notifications, so they are background — and therefore silent — unless
      // a caller explicitly opts into the foreground.
      isBackground: opts.isBackground ?? true,
      files,
      base,
    });
    this.persistQueue();
    this.processQueue();
    return id;
  }

  queueReplicaDelete(
    replicaKind: string,
    replicaId: string,
    displayTitle: string,
    filenames: string[],
    opts: { priority?: number; isBackground?: boolean } = {},
  ): string | null {
    if (!this.isReady()) {
      console.warn('TransferManager not initialized');
      return null;
    }
    const store = useTransferStore.getState();
    const existing = store.getReplicaTransfer(replicaKind, replicaId, 'delete');
    if (existing) return existing.id;

    const id = store.addReplicaTransfer(replicaKind, replicaId, displayTitle, 'delete', {
      priority: opts.priority,
      // Background by default — see the note on queueReplicaDownload.
      isBackground: opts.isBackground ?? true,
      files: filenames.map((logical) => ({ logical, lfp: '', byteSize: 0 })),
    });
    this.persistQueue();
    this.processQueue();
    return id;
  }

  cancelTransfer(transferId: string): void {
    const controller = this.abortControllers.get(transferId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(transferId);
    }

    useTransferStore.getState().setTransferStatus(transferId, 'cancelled', undefined, 'user');
    this.persistQueue();
  }

  async finishScholarConflict(
    transferId: string,
    fileId: string,
    versionId: string,
    useLocal: boolean,
  ): Promise<void> {
    const task = useTransferStore.getState().transfers[transferId];
    if (
      !task || task.status !== 'failed' || task.type !== 'upload' ||
      !task.error?.includes('Scholar file conflict') || !task.scholarAccountId ||
      !task.scholarOpId
    ) throw new Error('Scholar file conflict is no longer available');
    const accountId = await getScholarAccountId();
    if (accountId !== task.scholarAccountId) throw new Error('Scholar upload account changed');
    const book = this.getLibrary?.().find((item) => item.hash === task.bookHash);
    if (!book) throw new Error('Book not found in library');

    const filePath = CLOUD_BOOKS_SUBDIR + '/' + getRemoteBookFilename(book);
    saveScholarFileBaseline(accountId, filePath, { fileId, versionId });
    if (useLocal) {
      book.uploadedAt = Date.now();
      await this.updateBook?.(book);
    }
    useTransferStore.getState().setTransferStatus(
      transferId, useLocal ? 'completed' : 'cancelled', undefined, 'user',
    );
    this.cleanupScholarSnapshots([task]);
    this.persistQueue();
  }

  private async getScholarDeleteConflictTask(transferId: string): Promise<TransferItem> {
    const task = useTransferStore.getState().transfers[transferId];
    if (!task || task.kind !== 'book' || task.type !== 'delete' ||
        task.status !== 'failed' || !task.error?.includes('Scholar delete conflict') ||
        !task.scholarAccountId || !task.scholarFilePath) {
      throw new Error('Scholar delete conflict is no longer available');
    }
    const accountId = await getScholarAccountId();
    if (accountId !== task.scholarAccountId) throw new Error('Scholar delete account changed');
    return task;
  }

  async keepScholarCloudAfterDeleteConflict(
    transferId: string, fileId: string, activeVersionId: string,
  ): Promise<void> {
    const task = await this.getScholarDeleteConflictTask(transferId);
    const baseline = getScholarFileBaseline(task.scholarAccountId!, task.scholarFilePath!);
    if (baseline && baseline.fileId !== fileId) {
      throw new Error('Scholar file identity changed; refresh this dialog');
    }
    const book = this.getLibrary?.().find((item) => item.hash === task.bookHash);
    if (!book) throw new Error('Book not found in library');
    // A no-op CAS verifies the reviewed cloud head atomically before the
    // client's baseline and any local tombstone are changed.
    await fetchWithAuth(getAPIBaseUrl() + '/scholar/files/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId, versionId: activeVersionId, expectedVersionId: activeVersionId,
      }),
    });
    if (book.deletedAt || !book.uploadedAt) {
      await this.updateBook?.({
        ...book,
        deletedAt: null,
        fileSyncDeletionRequestedAt: null,
        uploadedAt: book.uploadedAt ?? Date.now(),
        updatedAt: Math.max(Date.now(), (book.updatedAt ?? 0) + 1),
      });
    }
    saveScholarFileBaseline(task.scholarAccountId!, task.scholarFilePath!, {
      fileId, versionId: activeVersionId,
    });
    // The delete was explicitly abandoned after restoring the library entry.
    // Remove its failed queue row so the Failed count reflects unresolved work.
    useTransferStore.getState().removeTransfer(transferId);
    this.persistQueue();
  }

  async requeueScholarDeleteConflict(
    transferId: string, fileId: string, activeVersionId: string,
  ): Promise<void> {
    const task = await this.getScholarDeleteConflictTask(transferId);
    const baseline = getScholarFileBaseline(task.scholarAccountId!, task.scholarFilePath!);
    if (baseline && baseline.fileId !== fileId) {
      throw new Error('Scholar file identity changed; refresh this dialog');
    }
    useTransferStore.getState().rebaseScholarDelete(transferId, activeVersionId);
    if (useTransferStore.getState().transfers[transferId]?.status !== 'pending') {
      throw new Error('Scholar delete conflict is no longer available');
    }
    this.persistQueue();
    this.processQueue();
  }

  retryTransfer(transferId: string): void {
    const store = useTransferStore.getState();
    const task = store.transfers[transferId];
    if (!task || !isRetryableTransfer(task)) return;
    store.retryTransfer(transferId);
    this.persistQueue();
    this.processQueue();
  }

  retryAllFailed(): void {
    const store = useTransferStore.getState();
    const failed = store.getFailedTransfers();
    failed.forEach((transfer) => {
      if (!isRetryableTransfer(transfer)) return;
      store.retryTransfer(transfer.id);
    });
    this.persistQueue();
    this.processQueue();
  }

  pauseQueue(): void {
    useTransferStore.getState().pauseQueue();
    this.persistQueue();
  }

  resumeQueue(): void {
    useTransferStore.getState().resumeQueue();
    this.processQueue();
    this.persistQueue();
  }

  clearPending(): void {
    const tasks = useTransferStore.getState().getPendingTransfers();
    useTransferStore.getState().clearPending();
    this.cleanupScholarSnapshots(tasks);
    this.persistQueue();
  }

  clearCompleted(): void {
    const tasks = useTransferStore.getState().getCompletedTransfers();
    useTransferStore.getState().clearCompleted();
    this.cleanupScholarSnapshots(tasks);
    this.persistQueue();
  }

  clearFailed(): void {
    const tasks = useTransferStore.getState().getFailedTransfers();
    useTransferStore.getState().clearFailed();
    // The store retains unresolved Scholar conflicts; their staged upload
    // bytes must remain available for the user's eventual resolution.
    const removed = tasks.filter((task) => !useTransferStore.getState().transfers[task.id]);
    this.cleanupScholarSnapshots(removed);
    this.persistQueue();
  }

  clearAll(): void {
    const tasks = Object.values(useTransferStore.getState().transfers);
    useTransferStore.getState().clearAll();
    this.cleanupScholarSnapshots(tasks);
    this.persistQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      this.processRequested = true;
      return;
    }

    this.isProcessing = true;
    try {
      await this._processQueueInternal();
    } finally {
      this.isProcessing = false;
      if (this.processRequested) {
        this.processRequested = false;
        queueMicrotask(() => this.processQueue());
      }
    }
  }

  private async _processQueueInternal(): Promise<void> {
    this.reconcileUploadsWithProvider();

    const store = useTransferStore.getState();

    if (store.isQueuePaused) return;

    const pending = store.getPendingTransfers().filter((t) =>
      !this.isDeferredBookUpload(t) && (!t.scholarSnapshotRequired || !!t.scholarSnapshotPath));
    const activeCount = store.getActiveTransfers().length;
    const maxConcurrent = store.maxConcurrent;

    const availableSlots = maxConcurrent - activeCount;
    if (availableSlots <= 0 || pending.length === 0) return;

    // Sort by priority (lower = higher priority) then by createdAt
    const sortedPending = [...pending].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.createdAt - b.createdAt;
    });

    const toProcess = sortedPending.slice(0, availableSlots);

    await Promise.all(toProcess.map((transfer) => this.executeTransfer(transfer)));

    // Check if more items to process. Deferred book uploads (settings
    // not yet hydrated) don't count — re-looping on them every 100ms
    // would busy-wait; the settings subscription wakes them instead.
    const newStore = useTransferStore.getState();
    const processable = newStore.getPendingTransfers().filter((t) =>
      !this.isDeferredBookUpload(t) && (!t.scholarSnapshotRequired || !!t.scholarSnapshotPath));
    if (processable.length > 0 && !newStore.isQueuePaused) {
      setTimeout(() => this.processQueue(), 100);
    }
  }

  private async executeTransfer(transfer: TransferItem): Promise<void> {
    if (!this.appService || !this.getLibrary || !this.updateBook) {
      console.error('TransferManager not properly initialized');
      return;
    }

    const _ = this._!;
    const store = useTransferStore.getState();
    const abortController = new AbortController();
    this.abortControllers.set(transfer.id, abortController);

    store.setTransferStatus(transfer.id, 'in_progress');
    store.setActiveCount(store.getActiveTransfers().length + 1);

    const progressThrottle = createProgressThrottle((progress) => {
      const percentage = progress.total > 0 ? (progress.progress / progress.total) * 100 : 0;
      useTransferStore
        .getState()
        .updateTransferProgress(
          transfer.id,
          percentage,
          progress.progress,
          progress.total,
          progress.transferSpeed,
        );
    }, PROGRESS_THROTTLE_MS);

    const progressHandler = (progress: ProgressPayload) => {
      if (abortController.signal.aborted) return;
      progressThrottle.push(progress);
    };

    try {
      if (transfer.kind === 'replica') {
        await this.executeReplicaTransfer(transfer, progressHandler, abortController);
      } else {
        await this.executeBookTransfer(transfer, progressHandler, abortController);
      }
      // A transfer that cannot stop mid-flight must not report success once cancelled.
      if (abortController.signal.aborted) return;

      // Land the final progress value that the throttle may still be holding.
      progressThrottle.flush();
      useTransferStore.getState().setTransferStatus(transfer.id, 'completed');
      this.cleanupScholarSnapshots([transfer]);

      const messages = getTransferMessages(transfer, _);

      if (!transfer.isBackground) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          timeout: 2000,
          message: messages.success[transfer.type],
        });
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        // Already cancelled, don't update status
        return;
      }

      const errorMessage = error instanceof Error ? error.message : _('Unknown error');
      const currentStore = useTransferStore.getState();
      const currentTransfer = currentStore.transfers[transfer.id];

      // Quota exhaustion is permanent for this account state; retrying
      // burns three backoff rounds per book for the same 403.
      const isQuotaError = errorMessage.includes('Insufficient storage quota');
      const isPermanentError = isQuotaError || [
        'Scholar file conflict',
        'Scholar delete conflict',
        'Legacy Scholar delete queue needs requeue',
        'Scholar upload account changed',
        'Scholar download account changed',
        'Legacy Scholar download queue needs requeue',
        'Legacy upload queue needs requeue',
        'Scholar upload snapshot',
      ].some((message) => errorMessage.includes(message));

      if (
        !isPermanentError &&
        currentTransfer &&
        currentTransfer.retryCount < currentTransfer.maxRetries
      ) {
        // Schedule retry with exponential backoff
        const delay = RETRY_DELAY_BASE_MS * Math.pow(2, currentTransfer.retryCount);
        currentStore.incrementRetryCount(transfer.id);
        currentStore.setTransferStatus(
          transfer.id,
          'pending',
          `Retry ${currentTransfer.retryCount + 1}/${currentTransfer.maxRetries}`,
        );

        setTimeout(() => {
          this.processQueue();
        }, delay);
      } else {
        // Background work fails quietly. The success path has always honoured
        // `isBackground`; the failure path did not, so a broken replica sync
        // fired one toast per file (issue #5675 — sixteen "Failed to download
        // file" toasts for sixteen fonts). The failure is still recorded on
        // the transfer, which is what the Transfer Queue panel reads.
        if (!transfer.isBackground) {
          if (errorMessage.includes('Not authenticated')) {
            eventDispatcher.dispatch('toast', {
              type: 'error',
              message: _('Please log in to continue'),
            });
          } else if (isQuotaError) {
            this.recordQuotaFailure();
          } else {
            const errorMessages = getTransferMessages(transfer, _).failure;

            eventDispatcher.dispatch('toast', {
              type: 'error',
              message: errorMessages[transfer.type],
            });
          }
        }

        useTransferStore.getState().setTransferStatus(transfer.id, 'failed', errorMessage);
      }
    } finally {
      // Drop any pending throttled progress + its trailing timer (a
      // failed/aborted transfer's stale progress must not fire after teardown).
      progressThrottle.cancel();
      this.abortControllers.delete(transfer.id);

      const currentStore = useTransferStore.getState();
      currentStore.setActiveCount(Math.max(0, currentStore.getActiveTransfers().length));
      this.persistQueue();

      // Continue processing
      setTimeout(() => this.processQueue(), 100);
    }
  }

  private recordQuotaFailure(): void {
    this.quotaFailureCount += 1;
    if (this.quotaToastTimer) clearTimeout(this.quotaToastTimer);
    this.quotaToastTimer = setTimeout(() => this.flushQuotaToast(), QUOTA_TOAST_FLUSH_MS);
  }

  private flushQuotaToast(): void {
    const _ = this._;
    const count = this.quotaFailureCount;
    this.quotaFailureCount = 0;
    this.quotaToastTimer = null;
    if (!count || !_) return;

    eventDispatcher.dispatch('toast', {
      type: 'error',
      message:
        count === 1
          ? _('Insufficient storage quota')
          : _('{{count}} uploads failed: insufficient storage quota', { count }),
    });
  }

  private async executeBookTransfer(
    transfer: TransferItem,
    progressHandler: (p: ProgressPayload) => void,
    abortController: AbortController,
  ): Promise<void> {
    const _ = this._!;
    const library = this.getLibrary!();
    const book = library.find((b) => b.hash === transfer.bookHash);

    if (!book) {
      throw new Error(_('Book not found in library'));
    }

    if (book.format === 'ABS' && transfer.type === 'download') {
      const { downloadAbsForOffline } = await import('@/services/audiobookshelf/offline');
      await downloadAbsForOffline(this.appService!, book, progressHandler, abortController.signal);
      if (abortController.signal.aborted) return;
      book.absDownloadedAt = Date.now();
      await this.updateBook!(book);
      return;
    }

    if (transfer.type === 'upload') {
      let scholar: ScholarFileUploadContext | undefined;
      if ((isScholarReleaseBundle() || isScholarTestBundle())) {
        const currentAccount = await getScholarAccountId();
        if (!currentAccount || currentAccount !== transfer.scholarAccountId) {
          this.cleanupScholarSnapshots([transfer]);
          throw new Error('Scholar upload account changed; requeue under the current account');
        }
        if (!transfer.scholarOpId || transfer.scholarExpectedVersionId === undefined ||
            !transfer.scholarSnapshotRequired || !transfer.scholarSnapshotPath) {
          throw new Error('Legacy upload queue needs requeue for Scholar file versions and snapshot');
        }
        if (!(await this.appService!.exists(transfer.scholarSnapshotPath, 'Cache'))) {
          useTransferStore.getState().setScholarSnapshotPath(transfer.id, undefined);
          throw new Error('Scholar upload snapshot missing; requeue');
        }
        scholar = {
          accountId: currentAccount,
          opId: transfer.scholarOpId,
          expectedVersionId: transfer.scholarExpectedVersionId,
          snapshotPath: transfer.scholarSnapshotPath,
        };
      }
      await this.appService!.uploadBook(book, progressHandler, scholar);
      book.uploadedAt = Date.now();
      await this.updateBook!(book);
    } else if (transfer.type === 'download') {
      if ((isScholarReleaseBundle() || isScholarTestBundle()) && !transfer.scholarAccountId) {
        throw new Error('Legacy Scholar download queue needs requeue');
      }
      if (transfer.scholarAccountId &&
          (await getScholarAccountId()) !== transfer.scholarAccountId) {
        throw new Error('Scholar download account changed; requeue under the current account');
      }
      const refreshScholarFile = !!transfer.scholarAccountId && !!book.uploadedAt &&
        book.uploadedAt > (book.downloadedAt ?? 0);
      await this.appService!.downloadBook(book, false, refreshScholarFile, progressHandler);
      if (abortController.signal.aborted || (transfer.scholarAccountId &&
          (await getScholarAccountId()) !== transfer.scholarAccountId)) {
        throw new Error('Scholar download account changed; requeue under the current account');
      }
      book.downloadedAt = Math.max(Date.now(), book.uploadedAt ?? 0);
      await this.updateBook!(book);
    } else if (transfer.type === 'delete') {
      if (isScholarReleaseBundle() || isScholarTestBundle()) {
        const currentAccount = await getScholarAccountId();
        if (!currentAccount || currentAccount !== transfer.scholarAccountId) {
          throw new Error('Scholar upload account changed; requeue under the current account');
        }
        if (!transfer.scholarOpId || !transfer.scholarFilePath ||
            transfer.scholarExpectedVersionId === undefined) {
          throw new Error('Legacy Scholar delete queue needs requeue');
        }
        await fetchWithAuth(getAPIBaseUrl() + '/scholar/files/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: transfer.scholarFilePath,
            opId: transfer.scholarOpId,
            expectedVersionId: transfer.scholarExpectedVersionId,
          }),
        });
        // The logical file is tombstoned; retained version objects are never
        // removed by the generic storage endpoint.
        book.uploadedAt = null;
      } else {
        await this.appService!.deleteBook(book, 'cloud');
      }
      await this.updateBook!(book);
    }
  }

  private async executeReplicaTransfer(
    transfer: TransferItem,
    progressHandler: (p: ProgressPayload) => void,
    _abortController: AbortController,
  ): Promise<void> {
    const kind = transfer.replicaKind!;
    const replicaId = transfer.replicaId!;
    const files = transfer.replicaFiles ?? [];

    if (transfer.type === 'delete') {
      await this.appService!.deleteReplicaBundle(
        kind,
        replicaId,
        files.map((f) => f.logical),
      );
      eventDispatcher.dispatch('replica-transfer-complete', {
        kind,
        replicaId,
        type: 'delete',
        filenames: files.map((f) => f.logical),
      });
      return;
    }

    if (files.length === 0) {
      throw new Error(`replica ${transfer.type} requires replicaFiles on the transfer`);
    }

    const totalBytes = files.reduce((sum, f) => sum + f.byteSize, 0) || 1;
    let bytesAlreadyDone = 0;
    const fileProgressHandler =
      (filenameSize: number): ProgressHandler =>
      (p: ProgressPayload) => {
        const fileFraction = p.total > 0 ? p.progress / p.total : 0;
        const overallTransferred = bytesAlreadyDone + filenameSize * fileFraction;
        progressHandler({
          progress: overallTransferred,
          total: totalBytes,
          transferSpeed: p.transferSpeed,
        });
      };

    if (transfer.type === 'upload') {
      const base = transfer.replicaBase!;
      for (const file of files) {
        await this.appService!.uploadReplicaFile(
          kind,
          replicaId,
          file.logical,
          file.lfp,
          base,
          fileProgressHandler(file.byteSize),
        );
        bytesAlreadyDone += file.byteSize;
      }
      eventDispatcher.dispatch('replica-transfer-complete', {
        kind,
        replicaId,
        reincarnation: transfer.replicaReincarnation,
        type: 'upload',
        files,
      });
      return;
    }

    if (transfer.type === 'download') {
      const base = transfer.replicaBase!;
      for (const file of files) {
        await this.appService!.downloadReplicaFile(
          kind,
          replicaId,
          file.logical,
          file.lfp,
          base,
          fileProgressHandler(file.byteSize),
        );
        bytesAlreadyDone += file.byteSize;
      }
      eventDispatcher.dispatch('replica-transfer-complete', {
        kind,
        replicaId,
        type: 'download',
        files,
      });
      return;
    }
  }

  private async loadPersistedQueue(): Promise<void> {
    try {
      if (typeof localStorage === 'undefined') return;

      const stored = localStorage.getItem(TRANSFER_QUEUE_KEY);
      if (!stored) return;

      const data: PersistedQueueData = JSON.parse(stored);
      const store = useTransferStore.getState();

      // Restore all transfers using the store's restore method
      // This preserves the original IDs and handles in_progress -> pending conversion
      store.restoreTransfers(data.transfers, data.isQueuePaused);
    } catch (error) {
      console.error('Failed to load transfer queue:', error);
    }
  }

  private persistQueue(): void {
    try {
      if (typeof localStorage === 'undefined') return;

      const store = useTransferStore.getState();

      // Persist all transfers including completed (for history)
      const data: PersistedQueueData = {
        schemaVersion: QUEUE_SCHEMA_VERSION,
        transfers: store.transfers,
        isQueuePaused: store.isQueuePaused,
      };

      localStorage.setItem(TRANSFER_QUEUE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to persist transfer queue:', error);
    }
  }
}

export const transferManager = TransferManager.getInstance();
