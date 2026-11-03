import { useEffect, useRef } from 'react';

import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { EnvConfigType } from '@/services/environment';
import {
  applyJobToBook,
  finalizeJob,
  getJob,
  isTranslationInFlight,
} from '@/services/scholarTranslation';
import { useTranslationStore } from '@/store/translationStore';

export const TRANSLATION_POLL_INTERVAL_MS = 5000;

/**
 * Poll only books whose synced translation state is queued/running, and only
 * while the library page is mounted and visible. The effect keys on the set of
 * in-flight jobs, not the books array, so page-turn writes cannot restart it.
 */
export function useLibraryTranslationPolling(
  books: Book[],
  deps: { envConfig: EnvConfigType | null; appService: AppService | null; enabled?: boolean },
): void {
  const { envConfig, appService, enabled = true } = deps;
  const booksRef = useRef(books);
  booksRef.current = books;
  const runningRef = useRef(false);

  const targetKey = books
    .filter(isTranslationInFlight)
    .map((book) => `${book.hash}:${book.translation?.jobId ?? ''}`)
    .sort()
    .join('|');

  useEffect(() => {
    if (!enabled || !envConfig || !appService) return;

    const pass = async () => {
      if (runningRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const active = booksRef.current.filter(isTranslationInFlight);
      if (active.length === 0) return;
      runningRef.current = true;
      try {
        for (const book of active) {
          const jobId = book.translation?.jobId;
          if (!jobId) continue;
          try {
            const job = await getJob(jobId);
            if (job.state === 'succeeded') {
              const store = useTranslationStore.getState();
              if (!store.beginFinalize(book.hash)) continue;
              try {
                await finalizeJob(envConfig, appService, book, job);
              } finally {
                store.endFinalize(book.hash);
              }
            } else {
              await applyJobToBook(envConfig, book, job);
            }
          } catch {
            // A transient network/404 failure just retries on the next tick; the
            // server's job state remains the source of truth.
          }
        }
      } finally {
        runningRef.current = false;
      }
    };

    void pass();
    const timer = window.setInterval(() => void pass(), TRANSLATION_POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void pass();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [targetKey, enabled, envConfig, appService]);
}
