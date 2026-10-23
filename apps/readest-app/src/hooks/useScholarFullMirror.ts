import { useEffect } from 'react';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import type { TransferItem } from '@/store/transferStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useTransferStore } from '@/store/transferStore';
import { useSettingsStore } from '@/store/settingsStore';
import { transferManager } from '@/services/transferManager';
import { getScholarAccountId } from '@/services/scholarFileBaseline';
import {
  getScholarFileCacheMode,
  getScholarMirrorConnection,
  isScholarMirrorNetworkAllowed,
  isScholarFileCacheModeKey,
  SCHOLAR_FILE_CACHE_MODE_EVENT,
} from '@/services/scholarFileCacheMode';
import { isReadestCloudStorageActive } from '@/services/sync/cloudSyncProvider';
import { isScholarReleaseBundle, isScholarTestBundle, isTauriAppPlatform } from '@/services/environment';
import { isFeedBook } from '@/services/rss/feedBookUrl';
import { isAbsEbook, isAudiobook } from '@/utils/audiobook';

/** Exclude fileless and already queued books; never spin on a failed transfer. */
export function shouldMirrorScholarBook(book: Book, transfers: TransferItem[], accountId?: string): boolean {
  if (book.deletedAt || !book.uploadedAt || isFeedBook(book) ||
      isAudiobook(book) || isAbsEbook(book)) return false;
  return !transfers.some((item) => item.kind === 'book' && item.type === 'download' &&
    item.bookHash === book.hash && item.status !== 'completed' &&
    (!accountId || item.scholarAccountId === accountId));
}

/**
 * Full mirror is opt-in per device/account. On launch we verify local bytes,
 * even if an old downloadedAt stamp survived an external file removal. Later
 * library updates inspect newly remote-only books and let the transfer queue
 * own retries and persistence.
 */
export function useScholarFullMirror(
  accountId: string | undefined,
  libraryLoaded: boolean,
  appService: AppService | null | undefined,
): void {
  useEffect(() => {
    if (!accountId || !libraryLoaded || !appService || !isTauriAppPlatform() ||
        !(isScholarReleaseBundle() || isScholarTestBundle())) return;

    const isNativeMobile = appService.isIOSApp || appService.isAndroidApp;
    let disposed = false;
    let scanning = false;
    let rerun = false;
    let initialScan = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scan = async () => {
      if (scanning) { rerun = true; return; }
      scanning = true;
      try {
        if (getScholarFileCacheMode(accountId) !== 'full_mirror') {
          await transferManager.waitUntilReady();
          if (!disposed) transferManager.stopScholarFullMirror(accountId);
          return;
        }
        if (!isReadestCloudStorageActive(useSettingsStore.getState().settings)) {
          await transferManager.waitUntilReady();
          if (!disposed) transferManager.stopScholarFullMirror(accountId);
          return;
        }
        if (!isScholarMirrorNetworkAllowed(isNativeMobile)) {
          await transferManager.waitUntilReady();
          if (!disposed) transferManager.stopScholarFullMirror(accountId);
          return;
        }
        await transferManager.waitUntilReady();
        if (disposed || (await getScholarAccountId()) !== accountId) return;
        const books = useLibraryStore.getState().library;
        const checkAllLocalBytes = initialScan;
        initialScan = false;
        for (const book of books) {
          if (disposed || getScholarFileCacheMode(accountId) !== 'full_mirror' ||
              !isScholarMirrorNetworkAllowed(isNativeMobile)) break;
          const remoteNewer = !!book.uploadedAt && book.uploadedAt > (book.downloadedAt ?? 0);
          if (!checkAllLocalBytes && book.downloadedAt && !remoteNewer) continue;
          if (!shouldMirrorScholarBook(book, Object.values(useTransferStore.getState().transfers), accountId)) continue;
          try {
            if (!remoteNewer && await appService.isBookAvailable(book)) continue;
          } catch (error) {
            console.warn('Could not inspect Scholar local file for full mirror', error);
            continue;
          }
          if (disposed || getScholarFileCacheMode(accountId) !== 'full_mirror' ||
              (await getScholarAccountId()) !== accountId) break;
          transferManager.queueDownload(book, 20, true, true);
        }
      } finally {
        scanning = false;
        if (rerun && !disposed) { rerun = false; schedule(); }
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; void scan(); }, 0);
    };
    const onModeChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== accountId) return;
      initialScan = true;
      schedule();
    };
    const onStorage = (event: StorageEvent) => {
      if (!isScholarFileCacheModeKey(event.key, accountId)) return;
      initialScan = true;
      schedule();
    };
    const libraryUnsub = useLibraryStore.subscribe((state, previous) => {
      if (state.library !== previous.library) schedule();
    });
    const settingsUnsub = useSettingsStore.subscribe((state, previous) => {
      if (state.settings !== previous.settings) schedule();
    });
    window.addEventListener(SCHOLAR_FILE_CACHE_MODE_EVENT, onModeChange);
    window.addEventListener('storage', onStorage);
    const connection = getScholarMirrorConnection();
    const onNetworkChange = () => { initialScan = true; schedule(); };
    connection?.addEventListener('change', onNetworkChange);
    window.addEventListener('online', onNetworkChange);
    schedule();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      libraryUnsub();
      settingsUnsub();
      window.removeEventListener(SCHOLAR_FILE_CACHE_MODE_EVENT, onModeChange);
      window.removeEventListener('storage', onStorage);
      connection?.removeEventListener('change', onNetworkChange);
      window.removeEventListener('online', onNetworkChange);
    };
  }, [accountId, libraryLoaded, appService]);
}
