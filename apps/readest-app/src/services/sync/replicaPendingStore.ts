import type { ReplicaRow } from '@/types/replica';
import type { PendingRowStore } from './replicaSyncManager';

const PREFIX = 'readest.replica.pending.v1:';
const keyOf = (row: ReplicaRow) =>
  `${PREFIX}${JSON.stringify([row.user_id, row.kind, row.replica_id])}`;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isReplicaRow = (value: unknown): value is ReplicaRow => {
  if (!isPlainObject(value)) return false;
  if (
    typeof value['user_id'] !== 'string' ||
    !value['user_id'] ||
    typeof value['kind'] !== 'string' ||
    !value['kind'] ||
    typeof value['replica_id'] !== 'string' ||
    !value['replica_id'] ||
    typeof value['updated_at_ts'] !== 'string' ||
    !value['updated_at_ts'] ||
    !Number.isInteger(value['schema_version']) ||
    Number(value['schema_version']) < 1 ||
    !isPlainObject(value['fields_jsonb']) ||
    (value['manifest_jsonb'] !== null && !isPlainObject(value['manifest_jsonb'])) ||
    (value['deleted_at_ts'] !== null && typeof value['deleted_at_ts'] !== 'string') ||
    (value['reincarnation'] !== null && typeof value['reincarnation'] !== 'string')
  ) {
    return false;
  }
  return Object.values(value['fields_jsonb']).every(
    (field) =>
      isPlainObject(field) && typeof field['t'] === 'string' && typeof field['s'] === 'string',
  );
};

/**
 * Small, synchronous metadata outbox. Bookcases have their own journal and
 * are intentionally excluded. Writes happen before the in-memory queue is
 * mutated, so a storage error cannot be mistaken for a durable enqueue.
 */
export class LocalStoragePendingRowStore implements PendingRowStore {
  constructor(private readonly storage: Storage = localStorage) {}

  load(): ReplicaRow[] {
    const rows: ReplicaRow[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const raw = this.storage.getItem(key);
      if (!raw) continue;
      try {
        const value: unknown = JSON.parse(raw);
        if (isReplicaRow(value) && value['kind'] !== 'bookshelf' && keyOf(value) === key) {
          rows.push(value);
        }
      } catch {
        // Preserve corrupt entries for diagnosis instead of silently deleting
        // the only copy of an edit. They are never sent to the server.
      }
    }
    return rows;
  }

  put(row: ReplicaRow): void {
    if (row.kind === 'bookshelf') return;
    if (!isReplicaRow(row)) throw new Error('Invalid replica pending row');
    this.storage.setItem(keyOf(row), JSON.stringify(row));
  }

  remove(row: ReplicaRow): boolean {
    if (row.kind === 'bookshelf') return true;
    const key = keyOf(row);
    const current = this.storage.getItem(key);
    if (current === null) return true;
    // Another window or a concurrent edit may have replaced this row while
    // the request was in flight. Clear only the exact acknowledged snapshot.
    if (current !== JSON.stringify(row)) return false;
    this.storage.removeItem(key);
    return true;
  }
}
