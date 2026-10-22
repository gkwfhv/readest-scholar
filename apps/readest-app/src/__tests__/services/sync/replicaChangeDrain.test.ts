import { beforeEach, describe, expect, test, vi } from 'vitest';
import { drainReplicaChanges } from '@/services/sync/replicaChangeDrain';
import { LocalStorageChangeCursorStore } from '@/services/sync/replicaChangeCursorStore';
import { hlcPack } from '@/libs/crdt';
import type { Hlc, ReplicaRow } from '@/types/replica';

const HLC = hlcPack(1_700_000_000_000, 0, 'a') as Hlc;
const row = (id: string, userId = 'account-a'): ReplicaRow => ({
  user_id: userId,
  kind: 'dictionary',
  replica_id: id,
  fields_jsonb: {},
  manifest_jsonb: null,
  deleted_at_ts: null,
  reincarnation: null,
  updated_at_ts: HLC,
  schema_version: 1,
});

beforeEach(() => localStorage.clear());

describe('drainReplicaChanges', () => {
  test('applies and persists every page before acknowledging its cursor', async () => {
    const store = new LocalStorageChangeCursorStore(localStorage, 'window-a');
    const pullChanges = vi
      .fn()
      .mockResolvedValueOnce({
        changes: [
          { seq: '1', row: row('one') },
          { seq: '2', row: row('two') },
        ],
        nextCursor: '2',
        hasMore: true,
      })
      .mockResolvedValueOnce({
        changes: [{ seq: '3', row: row('three') }],
        nextCursor: '3',
        hasMore: false,
      });
    const seen: string[] = [];
    const applyPage = vi.fn(async (rows: ReplicaRow[]) => {
      seen.push(...rows.map((item) => item.replica_id));
      expect(store.get('account-a', 'dictionary')).toBe(rows[0]!.replica_id === 'one' ? '0' : '2');
    });
    const result = await drainReplicaChanges({
      client: { pullChanges },
      cursorStore: store,
      userId: 'account-a',
      kind: 'dictionary',
      currentUserId: async () => 'account-a',
      applyPage,
      pageSize: 2,
    });
    expect(result).toEqual({ supported: true, pages: 2, hasMore: false });
    expect(pullChanges.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['dictionary', '0'],
      ['dictionary', '2'],
    ]);
    expect(seen).toEqual(['one', 'two', 'three']);
    expect(store.get('account-a', 'dictionary')).toBe('3');
  });

  test('a failed local persistence leaves the page available for retry', async () => {
    const store = new LocalStorageChangeCursorStore(localStorage, 'window-a');
    const page = { changes: [{ seq: '1', row: row('one') }], nextCursor: '1', hasMore: false };
    const pullChanges = vi.fn().mockResolvedValue(page);
    const applyPage = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk write failed'))
      .mockResolvedValueOnce(undefined);
    const opts = {
      client: { pullChanges },
      cursorStore: store,
      userId: 'account-a',
      kind: 'dictionary',
      currentUserId: async () => 'account-a',
      applyPage,
    };
    await expect(drainReplicaChanges(opts)).rejects.toThrow('disk write failed');
    expect(store.get('account-a', 'dictionary')).toBe('0');
    await drainReplicaChanges(opts);
    expect(pullChanges.mock.calls.map((call) => call[1])).toEqual(['0', '0']);
    expect(store.get('account-a', 'dictionary')).toBe('1');
  });

  test('account switch and cross-account response cannot apply or acknowledge', async () => {
    const store = new LocalStorageChangeCursorStore(localStorage, 'window-a');
    let current = 'account-a';
    const pullChanges = vi.fn(async () => {
      current = 'account-b';
      return { changes: [{ seq: '1', row: row('one') }], nextCursor: '1', hasMore: false };
    });
    const applyPage = vi.fn();
    const opts = {
      client: { pullChanges },
      cursorStore: store,
      userId: 'account-a',
      kind: 'dictionary',
      currentUserId: async () => current,
      applyPage,
    };
    await expect(drainReplicaChanges(opts)).rejects.toThrow();
    expect(applyPage).not.toHaveBeenCalled();
    expect(store.get('account-a', 'dictionary')).toBe('0');

    current = 'account-a';
    pullChanges.mockResolvedValueOnce({
      changes: [{ seq: '1', row: row('one', 'account-b') }],
      nextCursor: '1',
      hasMore: false,
    });
    await expect(drainReplicaChanges(opts)).rejects.toThrow();
    expect(applyPage).not.toHaveBeenCalled();
  });

  test('an old server preserves the cursor and reports unsupported', async () => {
    const store = new LocalStorageChangeCursorStore(localStorage, 'window-a');
    const result = await drainReplicaChanges({
      client: { pullChanges: vi.fn().mockResolvedValue(null) },
      cursorStore: store,
      userId: 'account-a',
      kind: 'dictionary',
      currentUserId: async () => 'account-a',
      applyPage: vi.fn(),
    });
    expect(result).toEqual({ supported: false, pages: 0, hasMore: false });
    expect(store.get('account-a', 'dictionary')).toBe('0');
  });
});
