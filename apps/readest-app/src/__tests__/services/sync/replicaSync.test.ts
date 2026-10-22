import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  __resetReplicaSyncForTests,
  getReplicaSync,
  initReplicaSync,
  isReplicaSyncReady,
} from '@/services/sync/replicaSync';
import { __resetSettledEventsForTests } from '@/utils/event';
import { InMemoryHlcStore } from '@/libs/hlcStore';
import { hlcPack } from '@/libs/crdt';
import { LocalStoragePendingRowStore } from '@/services/sync/replicaPendingStore';
import { registerReplicaAdapter, clearReplicaAdapters } from '@/services/sync/replicaRegistry';
import { useSettingsStore } from '@/store/settingsStore';
import type { ReplicaRow, Hlc } from '@/types/replica';
import type { CursorStore } from '@/services/sync/replicaSyncManager';

vi.mock('@/utils/access', () => ({ getUserID: async () => 'account-a' }));

const makePendingRow = (userId: string): ReplicaRow => {
  const t = hlcPack(Date.now(), 0, 'dev-a') as Hlc;
  return {
    user_id: userId,
    kind: 'dictionary',
    replica_id: 'same-id',
    fields_jsonb: { name: { v: userId, t, s: 'dev-a' } },
    manifest_jsonb: null,
    deleted_at_ts: null,
    reincarnation: null,
    updated_at_ts: t,
    schema_version: 1,
  };
};

const makeMemoryCursorStore = (): CursorStore => {
  const map = new Map<string, Hlc>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => {
      map.set(k, v);
    },
  };
};

const makeFakeClient = () => ({
  push: vi.fn(async (rows: ReplicaRow[]) => rows),
  pull: vi.fn(async (_kind: string, _since: Hlc | null) => [] as ReplicaRow[]),
});

afterEach(() => {
  __resetReplicaSyncForTests();
  __resetSettledEventsForTests();
  localStorage.clear();
  clearReplicaAdapters();
  useSettingsStore.setState({ settings: undefined } as never);
});

describe('replicaSync singleton', () => {
  test('getReplicaSync returns null before init', () => {
    expect(getReplicaSync()).toBe(null);
    expect(isReplicaSyncReady()).toBe(false);
  });

  test('initReplicaSync produces a manager + hlc context', () => {
    const ctx = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore: new InMemoryHlcStore(),
      client: makeFakeClient() as never,
    });
    expect(ctx.manager).toBeDefined();
    expect(ctx.hlc).toBeDefined();
    expect(ctx.deviceId).toBe('dev-a');
    expect(isReplicaSyncReady()).toBe(true);
  });

  test('subsequent initReplicaSync calls are idempotent (return same instance)', () => {
    const a = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore: new InMemoryHlcStore(),
      client: makeFakeClient() as never,
    });
    const b = initReplicaSync({
      deviceId: 'dev-different',
      cursorStore: makeMemoryCursorStore(),
      hlcStore: new InMemoryHlcStore(),
      client: makeFakeClient() as never,
    });
    expect(b).toBe(a);
    expect(b.deviceId).toBe('dev-a');
  });

  test('hlc.next() persists snapshot to the injected store', () => {
    const hlcStore = new InMemoryHlcStore();
    const ctx = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore,
      client: makeFakeClient() as never,
    });
    expect(hlcStore.load()).toBe(null);
    ctx.hlc.next();
    const snap = hlcStore.load();
    expect(snap).not.toBe(null);
    expect(snap!.counter).toBeGreaterThanOrEqual(0);
  });

  test('hlc.observe() persists snapshot to the injected store', () => {
    const hlcStore = new InMemoryHlcStore();
    const ctx = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore,
      client: makeFakeClient() as never,
    });
    ctx.hlc.observe('fffffffffffff-00000000-dev-other' as Hlc);
    expect(hlcStore.load()).not.toBe(null);
  });

  test('init restores from existing snapshot (counter survives reload)', () => {
    const hlcStore = new InMemoryHlcStore();
    // Choose a far-future ms so the wall clock won't advance past it during
    // the test — that way next() bumps the counter rather than the ms.
    const farFutureMs = Date.now() + 10 * 60 * 60 * 1000;
    hlcStore.save({ physicalMs: farFutureMs, counter: 42 });
    const ctx = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore,
      client: makeFakeClient() as never,
    });
    const serialized = ctx.hlc.serialize();
    expect(serialized.physicalMs).toBe(farFutureMs);
    expect(serialized.counter).toBe(42);
    ctx.hlc.next();
    expect(ctx.hlc.serialize().counter).toBe(43);
  });

  test('__resetReplicaSyncForTests clears the singleton', () => {
    initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore: new InMemoryHlcStore(),
      client: makeFakeClient() as never,
    });
    expect(isReplicaSyncReady()).toBe(true);
    __resetReplicaSyncForTests();
    expect(isReplicaSyncReady()).toBe(false);
    expect(getReplicaSync()).toBe(null);
  });
});

describe('replicaSync durable outbox wiring', () => {
  test('replays a persisted non-bookshelf edit after initialization', async () => {
    const pending = new LocalStoragePendingRowStore();
    const row = makePendingRow('account-a');
    pending.put(row);
    const client = makeFakeClient();
    const ctx = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore: new InMemoryHlcStore(),
      client: client as never,
    });

    expect(ctx.manager.pendingCount()).toBe(1);
    await ctx.manager.flush();

    expect(client.push).toHaveBeenCalledWith([row]);
    expect(pending.load()).toEqual([]);
  });

  test('recovers the same unsent edit after a failed push and singleton restart', async () => {
    const row = makePendingRow('account-a');
    const failingClient = {
      ...makeFakeClient(),
      push: vi.fn(async (_rows: ReplicaRow[]): Promise<ReplicaRow[]> => {
        throw new Error('simulated offline');
      }),
    };
    const first = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore: new InMemoryHlcStore(),
      client: failingClient as never,
    });
    first.manager.markDirty(row);
    await expect(first.manager.flush()).rejects.toThrow('simulated offline');
    expect(new LocalStoragePendingRowStore().load()).toEqual([row]);

    __resetReplicaSyncForTests();
    const resumedClient = makeFakeClient();
    const resumed = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore: new InMemoryHlcStore(),
      client: resumedClient as never,
    });
    expect(resumed.manager.pendingCount()).toBe(1);
    await resumed.manager.flush();

    expect(resumedClient.push).toHaveBeenCalledWith([row]);
    expect(new LocalStoragePendingRowStore().load()).toEqual([]);
  });

  test('retains a long-offline field edit until transport and conflict clocks are separated', async () => {
    const stale = makePendingRow('account-a');
    const old = hlcPack(Date.now() - 120_000, 0, 'dev-a') as Hlc;
    stale.updated_at_ts = old;
    stale.fields_jsonb['name']!.t = old;
    new LocalStoragePendingRowStore().put(stale);
    const client = makeFakeClient();
    const ctx = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore: new InMemoryHlcStore(),
      client: client as never,
    });

    await ctx.manager.flush();

    expect(client.push).not.toHaveBeenCalled();
    expect(new LocalStoragePendingRowStore().load()).toEqual([stale]);
  });

  test('does not restamp a stale deletion past a later reincarnation', async () => {
    const stale = makePendingRow('account-a');
    const old = hlcPack(Date.now() - 120_000, 0, 'dev-a') as Hlc;
    stale.updated_at_ts = old;
    stale.deleted_at_ts = old;
    stale.fields_jsonb = {};
    new LocalStoragePendingRowStore().put(stale);
    const client = makeFakeClient();
    const ctx = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore: new InMemoryHlcStore(),
      client: client as never,
    });

    await ctx.manager.flush();

    expect(client.push).not.toHaveBeenCalled();
    expect(new LocalStoragePendingRowStore().load()).toEqual([stale]);
  });

  test('retains a stale manifest for conflict resolution rather than overwriting a newer file', async () => {
    const stale = makePendingRow('account-a');
    stale.updated_at_ts = hlcPack(Date.now() - 120_000, 0, 'dev-a') as Hlc;
    stale.manifest_jsonb = { files: [], schemaVersion: 1 };
    new LocalStoragePendingRowStore().put(stale);
    const client = makeFakeClient();
    const ctx = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore: new InMemoryHlcStore(),
      client: client as never,
    });

    await ctx.manager.flush();

    expect(client.push).not.toHaveBeenCalled();
    expect(new LocalStoragePendingRowStore().load()).toEqual([stale]);
  });

  test('does not send queued encrypted fields after credential sync is disabled', async () => {
    registerReplicaAdapter({
      kind: 'opds_catalog',
      schemaVersion: 1,
      pack: () => ({}),
      unpack: () => ({}),
      computeId: async () => 'same-id',
      unpackRow: () => null,
      encryptedFields: ['username'],
    });
    const row = makePendingRow('account-a');
    row.kind = 'opds_catalog';
    row.fields_jsonb['username'] = {
      v: { c: 'encrypted-test-value' },
      t: row.updated_at_ts,
      s: 'dev-a',
    };
    new LocalStoragePendingRowStore().put(row);
    useSettingsStore.setState({ settings: { syncCategories: { credentials: false } } } as never);
    const client = makeFakeClient();
    const ctx = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore: new InMemoryHlcStore(),
      client: client as never,
    });

    await ctx.manager.flush();

    const sent = client.push.mock.calls[0]?.[0]?.[0];
    expect(sent?.fields_jsonb['name']).toEqual(row.fields_jsonb['name']);
    expect(sent?.fields_jsonb['username']).toBeUndefined();
    expect(new LocalStoragePendingRowStore().load()).toEqual([]);
  });

  test('never uploads a persisted row belonging to another signed-in account', async () => {
    const pending = new LocalStoragePendingRowStore();
    const own = makePendingRow('account-a');
    const other = makePendingRow('account-b');
    pending.put(own);
    pending.put(other);
    const client = makeFakeClient();
    const ctx = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore: new InMemoryHlcStore(),
      client: client as never,
    });

    await ctx.manager.flush();

    expect(client.push).toHaveBeenCalledExactlyOnceWith([own]);
    expect(pending.load()).toEqual([other]);
  });
});
