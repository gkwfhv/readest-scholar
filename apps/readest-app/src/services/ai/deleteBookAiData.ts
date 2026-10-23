import type { AppService } from '@/types/system';
import { aiAccountScope } from './accountScope';
import { aiStore } from './storage/aiStore';
import {
  advanceBookAiGeneration,
  cancelBookAiWork,
  pendingBookAiDeletionKey,
  waitForBookAiWork,
} from './bookAiWork';

const PENDING_PREFIX = 'scholar-ai-pending-book-delete:v1:';

export interface PendingAiDeletion {
  bookHash: string;
  userId: string | null;
}

function pendingKey(bookHash: string, userId: string | null): string {
  return pendingBookAiDeletionKey(aiAccountScope(bookHash, userId));
}

/** Queue a local cleanup so a database error can be retried after restart. */
export function queueBookAiDataDeletion(bookHash: string, userId: string | null): void {
  const key = pendingKey(bookHash, userId);
  if (localStorage.getItem(key) === null) {
    advanceBookAiGeneration(aiAccountScope(bookHash, userId));
    localStorage.setItem(key, JSON.stringify({ bookHash, userId }));
  }
  cancelBookAiWork(aiAccountScope(bookHash, userId));
}

export async function deleteBookAiData(
  bookHash: string,
  userId: string | null,
  appService: Pick<AppService, 'appPlatform' | 'openDatabase'>,
): Promise<void> {
  const scope = aiAccountScope(bookHash, userId);
  // A direct caller must provide the same durable guard as the app-service path.
  if (localStorage.getItem(pendingKey(bookHash, userId)) === null) {
    queueBookAiDataDeletion(bookHash, userId);
  }
  // Stop the active UI turn before deleting its backing rows.
  const [{ useAIChatStore }, { useReedyStore }] = await Promise.all([
    import('@/store/aiChatStore'),
    import('@/services/reedy/store/reedyStore'),
  ]);
  useAIChatStore.getState().invalidateBookScope(scope);
  if (useReedyStore.getState().scope === scope) {
    useReedyStore.getState().reset();
    useReedyStore.setState({ scope: null });
  }
  // A delayed embedding or IndexedDB/SQLite write must finish before the final purge.
  await waitForBookAiWork(scope);
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

/** Retry durable delete intents, including a crash during physical deletion. */
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
