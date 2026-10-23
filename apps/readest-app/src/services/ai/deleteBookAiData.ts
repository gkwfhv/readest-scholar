import type { AppService } from '@/types/system';
import { aiAccountScope } from './accountScope';
import { aiStore } from './storage/aiStore';

const PENDING_PREFIX = 'scholar-ai-pending-book-delete:v1:';

export interface PendingAiDeletion {
  bookHash: string;
  userId: string | null;
}

function pendingKey(bookHash: string, userId: string | null): string {
  return PENDING_PREFIX + encodeURIComponent(aiAccountScope(bookHash, userId));
}

/** Queue a local cleanup so a database error can be retried after restart. */
export function queueBookAiDataDeletion(bookHash: string, userId: string | null): void {
  localStorage.setItem(pendingKey(bookHash, userId), JSON.stringify({ bookHash, userId }));
}

export async function deleteBookAiData(
  bookHash: string,
  userId: string | null,
  appService: Pick<AppService, 'appPlatform' | 'openDatabase'>,
): Promise<void> {
  const scope = aiAccountScope(bookHash, userId);
  const conversations = await aiStore.getConversations(scope);
  await aiStore.clearBook(scope);
  for (const conversation of conversations) {
    await aiStore.deleteConversation(conversation.id);
  }
  if (appService.appPlatform === 'tauri') {
    const { ReedyDb } = await import('@/services/reedy/db/ReedyDb');
    const db = await appService.openDatabase('reedy', 'reedy.db', 'Data', {
      experimental: ['index_method'],
    });
    await new ReedyDb(db).purgeBookData(scope);
  }
  localStorage.removeItem(pendingKey(bookHash, userId));
}

/** Retry only entries that were written after a successful local book deletion. */
export async function retryPendingBookAiDataDeletions(
  appService: Pick<AppService, 'appPlatform' | 'openDatabase'>,
): Promise<void> {
  const entries: PendingAiDeletion[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PENDING_PREFIX)) continue;
    try {
      const value = JSON.parse(localStorage.getItem(key) || '') as PendingAiDeletion;
      if (
        typeof value.bookHash === 'string' &&
        (value.userId === null || typeof value.userId === 'string') &&
        key === pendingKey(value.bookHash, value.userId)
      ) {
        entries.push(value);
      }
    } catch {
      // Malformed local storage must not become a deletion target.
    }
  }
  for (const entry of entries) {
    try {
      await deleteBookAiData(entry.bookHash, entry.userId, appService);
    } catch (error) {
      console.warn('Pending book AI data cleanup failed; will retry later', error);
    }
  }
}
