import { afterEach, describe, expect, test } from 'vitest';
import { hlcPack } from '@/libs/crdt';
import { LocalStorageReplicaConflictStore } from '@/services/sync/replicaConflictStore';
import type { Hlc, ReplicaRow } from '@/types/replica';

const old = hlcPack(1_700_000_000_000, 0, 'a') as Hlc;
const fresh = hlcPack(1_700_000_120_000, 0, 'b') as Hlc;
const row = (user: string, value: string, clock: Hlc): ReplicaRow => ({
  user_id: user,
  kind: 'settings',
  replica_id: 'singleton',
  fields_jsonb: { theme: { v: value, t: clock, s: value } },
  manifest_jsonb: null,
  deleted_at_ts: null,
  reincarnation: null,
  updated_at_ts: clock,
  schema_version: 1,
});

afterEach(() => localStorage.clear());

describe('LocalStorageReplicaConflictStore', () => {
  test('keeps a losing field version and deduplicates a repeated push', () => {
    const store = new LocalStorageReplicaConflictStore();
    const sent = row('account-a', 'dark', old);
    const merged = row('account-a', 'light', fresh);
    store.record(sent, merged);
    store.record(sent, merged);
    expect(store.load('account-a')).toEqual([
      expect.objectContaining({
        userId: 'account-a',
        kind: 'settings',
        replicaId: 'singleton',
        field: 'theme',
        local: sent.fields_jsonb['theme'],
        remote: merged.fields_jsonb['theme'],
      }),
    ]);
    expect(store.load('account-b')).toEqual([]);
  });

  test('does not create a conflict when the server accepted the same field', () => {
    const store = new LocalStorageReplicaConflictStore();
    const sent = row('account-a', 'dark', old);
    store.record(sent, { ...sent, updated_at_ts: fresh });
    expect(store.load('account-a')).toEqual([]);
  });

  test('refuses a merge response for another account or replica', () => {
    const store = new LocalStorageReplicaConflictStore();
    const sent = row('account-a', 'dark', old);
    expect(() => store.record(sent, row('account-b', 'light', fresh))).toThrow();
    expect(() =>
      store.record(sent, { ...row('account-a', 'light', fresh), replica_id: 'other' }),
    ).toThrow();
    expect(store.load('account-a')).toEqual([]);
  });
});
