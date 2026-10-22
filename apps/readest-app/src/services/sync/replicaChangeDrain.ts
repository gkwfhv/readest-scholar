import type { ReplicaSyncClient } from '@/libs/replicaSyncClient';
import type { ReplicaRow } from '@/types/replica';

interface ChangeCursorStore {
  get(userId: string, kind: string): string;
  set(userId: string, kind: string, value: string): void;
}

interface ChangeDrainOptions {
  client: Pick<ReplicaSyncClient, 'pullChanges'>;
  cursorStore: ChangeCursorStore;
  userId: string;
  kind: string;
  currentUserId(): Promise<string | null>;
  /** Must resolve only after every row on the page is durably applied. */
  applyPage(rows: ReplicaRow[]): Promise<void>;
  pageSize?: number;
}

export const drainReplicaChanges = async ({
  client,
  cursorStore,
  userId,
  kind,
  currentUserId,
  applyPage,
  pageSize = 100,
}: ChangeDrainOptions): Promise<{ supported: boolean; pages: number; hasMore: boolean }> => {
  let after = cursorStore.get(userId, kind);
  for (let pages = 0; pages < 100; pages++) {
    if ((await currentUserId()) !== userId) throw new Error('Replica account changed');
    const page = await client.pullChanges(kind, after, pageSize);
    if (page === null) return { supported: false, pages, hasMore: false };
    if ((await currentUserId()) !== userId) throw new Error('Replica account changed');
    if (page.changes.some(({ row }) => row.user_id !== userId || row.kind !== kind)) {
      throw new Error('Replica change row belongs to another account or kind');
    }
    if (page.changes.length > 0) {
      await applyPage(page.changes.map(({ row }) => row));
      if ((await currentUserId()) !== userId) throw new Error('Replica account changed');
      cursorStore.set(userId, kind, page.nextCursor);
      after = page.nextCursor;
    } else if (page.hasMore) {
      throw new Error('Replica change page did not advance');
    }
    if (!page.hasMore) return { supported: true, pages: pages + 1, hasMore: false };
  }
  return { supported: true, pages: 100, hasMore: true };
};
