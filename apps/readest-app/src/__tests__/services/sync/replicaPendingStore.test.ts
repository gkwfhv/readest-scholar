import { beforeEach, describe, expect, test } from 'vitest';
import { hlcPack } from '@/libs/crdt';
import { LocalStoragePendingRowStore } from '@/services/sync/replicaPendingStore';
import type { Hlc, ReplicaRow } from '@/types/replica';

const NOW = 1_700_000_000_000;
const row = (id: string, userId = 'u1', offset = 0): ReplicaRow => {
  const t = hlcPack(NOW + offset, 0, 'dev-a') as Hlc;
  return {
    user_id: userId,
    kind: 'dictionary',
    replica_id: id,
    fields_jsonb: { name: { v: id, t, s: 'dev-a' } },
    manifest_jsonb: null,
    deleted_at_ts: null,
    reincarnation: null,
    updated_at_ts: t,
    schema_version: 1,
  };
};

beforeEach(() => {
  localStorage.clear();
});

describe('LocalStoragePendingRowStore', () => {
  test('restores a queued row after the store instance is recreated', () => {
    new LocalStoragePendingRowStore().put(row('paper'));
    expect(new LocalStoragePendingRowStore().load()).toEqual([row('paper')]);
  });

  test('keeps two accounts with the same kind and replica id separate', () => {
    const store = new LocalStoragePendingRowStore();
    store.put(row('same', 'u1'));
    store.put(row('same', 'u2'));
    expect(
      store
        .load()
        .map((item) => item.user_id)
        .sort(),
    ).toEqual(['u1', 'u2']);
  });

  test('does not duplicate bookshelf rows already handled by their own journal', () => {
    const store = new LocalStoragePendingRowStore();
    store.put({ ...row('shelf'), kind: 'bookshelf' });
    expect(store.load()).toEqual([]);
  });

  test('does not delete a newer row when a stale request is acknowledged', () => {
    const store = new LocalStoragePendingRowStore();
    const original = row('edited');
    const newer = row('edited', 'u1', 1);
    store.put(original);
    store.put(newer);
    store.remove(original);
    expect(store.load()).toEqual([newer]);
    store.remove(newer);
    expect(store.load()).toEqual([]);
  });

  test('ignores corrupt entries without deleting their contents', () => {
    const store = new LocalStoragePendingRowStore();
    store.put(row('valid'));
    localStorage.setItem('readest.replica.pending.v1:corrupt', '{bad json');
    expect(store.load()).toEqual([row('valid')]);
    expect(localStorage.getItem('readest.replica.pending.v1:corrupt')).toBe('{bad json');
  });
});
