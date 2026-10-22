import { acknowledgeBookshelfOperation } from '@/services/bookshelves/journal';
import { HlcGenerator, hlcParse } from '@/libs/crdt';
import { LocalStorageHlcStore, type HlcSnapshotStore } from '@/libs/hlcStore';
import { ReplicaSyncClient } from '@/libs/replicaSyncClient';
import { markSettled, onSettled } from '@/utils/event';
import { ReplicaSyncManager, type CursorStore } from './replicaSyncManager';
import { LocalStoragePendingRowStore } from './replicaPendingStore';
import { getReplicaAdapter } from './replicaRegistry';

const REPLICA_SYNC_READY_EVENT = 'replica-sync-ready';

export interface ReplicaSyncInitOpts {
  deviceId: string;
  cursorStore: CursorStore;
  hlcStore?: HlcSnapshotStore;
  client?: Pick<ReplicaSyncClient, 'push' | 'pull' | 'pullBatch'> &
    Partial<Pick<ReplicaSyncClient, 'pullChanges'>>;
}

export interface ReplicaSyncContext {
  manager: ReplicaSyncManager;
  hlc: HlcGenerator;
  deviceId: string;
  changeClient?: Pick<ReplicaSyncClient, 'pullChanges'>;
}

let instance: ReplicaSyncContext | null = null;

/**
 * Subscribe to be notified when `initReplicaSync` completes. Used by
 * useReplicaPull to recover from the boot race where appService
 * resolves first and triggers the hook's effect, but
 * `await service.loadSettings()` hasn't yet returned, so
 * `initReplicaSync` is still pending. The hook reads the singleton
 * synchronously and would early-return with no recovery path; the
 * subscription gives it a way to retry once the singleton lands.
 *
 * Listener fires once the singleton is created. If the singleton
 * already exists when subscribe is called, the listener is invoked
 * synchronously (replay) so callers don't need to deal with the race.
 *
 * Returns an unsubscribe function. Idempotent; safe to call from
 * effect cleanups. Backed by `onSettled('replica-sync-ready')`.
 */
export const subscribeReplicaSyncReady = (listener: () => void): (() => void) =>
  onSettled(REPLICA_SYNC_READY_EVENT, () => listener());

const wrapHlcWithPersistence = (hlc: HlcGenerator, hlcStore: HlcSnapshotStore): HlcGenerator => {
  const originalNext = hlc.next.bind(hlc);
  const originalObserve = hlc.observe.bind(hlc);
  hlc.next = () => {
    const v = originalNext();
    hlcStore.save(hlc.serialize());
    return v;
  };
  hlc.observe = (remote) => {
    originalObserve(remote);
    hlcStore.save(hlc.serialize());
  };
  return hlc;
};

export const initReplicaSync = (opts: ReplicaSyncInitOpts): ReplicaSyncContext => {
  if (instance) return instance;

  const hlcStore = opts.hlcStore ?? new LocalStorageHlcStore();
  const snapshot = hlcStore.load();
  const baseHlc = snapshot
    ? HlcGenerator.restore(snapshot, opts.deviceId)
    : new HlcGenerator(opts.deviceId);
  const hlc = wrapHlcWithPersistence(baseHlc, hlcStore);

  const client = opts.client ?? new ReplicaSyncClient();

  const manager = new ReplicaSyncManager({
    hlc,
    client,
    cursorStore: opts.cursorStore,
    pendingStore: new LocalStoragePendingRowStore(),
    prepareRow: async (row) => {
      const { getUserID } = await import('@/utils/access');
      const { isCredentialsSyncEnabled, isSyncCategoryEnabled } = await import('./syncCategories');
      // A durable row may belong to a previous sign-in. Never send it with
      // another account's token, and honor a category disabled after enqueue.
      if (row.user_id !== (await getUserID()) || !isSyncCategoryEnabled(row.kind)) return null;
      // A queued edit can outlive the credential-sync toggle. Recheck it at
      // send time so previously encrypted slots never leave this device after
      // the user opts out. Keep the durable original until this safe row lands.
      let prepared = row;
      if (!isCredentialsSyncEnabled()) {
        const encryptedFields = getReplicaAdapter(row.kind)?.encryptedFields;
        if (encryptedFields?.some((field) => field in row.fields_jsonb)) {
          const fields_jsonb = { ...row.fields_jsonb };
          for (const field of encryptedFields) delete fields_jsonb[field];
          prepared = { ...row, fields_jsonb };
        }
      }
      if (prepared.kind !== 'bookshelf') {
        let rowTime: number;
        let deletionTime: number | null;
        try {
          rowTime = hlcParse(row.updated_at_ts).physicalMs;
          deletionTime = row.deleted_at_ts ? hlcParse(row.deleted_at_ts).physicalMs : null;
        } catch {
          console.warn('replica pending row has a malformed timestamp', {
            kind: row.kind,
            replicaId: row.replica_id,
          });
          return null;
        }
        const now = Date.now();
        const outsideWindow =
          Math.abs(rowTime - now) > 30_000 ||
          (deletionTime !== null && Math.abs(deletionTime - now) > 30_000);
        if (outsideWindow) {
          // updated_at_ts is also the legacy manifest/reincarnation order and
          // pull cursor. Restamping any old row can silently reorder those
          // operations, so preserve it until a versioned transport cursor and
          // conflict protocol are available.
          console.warn('replica pending row requires versioned conflict handling', {
            kind: row.kind,
            replicaId: row.replica_id,
          });
          return null;
        }
        return prepared;
      }
      // Bookshelf operations retain their existing separate journal and
      // transport timestamp policy; this slice does not change that path.
      const updated_at_ts = hlc.next();
      if (hlcParse(updated_at_ts).physicalMs > Date.now() + 30_000) return null;
      return {
        ...prepared,
        updated_at_ts,
        ...(row.deleted_at_ts ? { deleted_at_ts: updated_at_ts } : {}),
      };
    },
    onAcknowledged: (row) => {
      if (row.kind === 'bookshelf') acknowledgeBookshelfOperation(row);
    },
  });

  instance = {
    manager,
    hlc,
    deviceId: opts.deviceId,
    changeClient: client.pullChanges ? { pullChanges: client.pullChanges.bind(client) } : undefined,
  };
  void markSettled(REPLICA_SYNC_READY_EVENT);
  return instance;
};

export const getReplicaSync = (): ReplicaSyncContext | null => instance;

export const isReplicaSyncReady = (): boolean => instance !== null;

export const __resetReplicaSyncForTests = (): void => {
  if (instance) {
    instance.manager.stopAutoSync();
  }
  instance = null;
};
