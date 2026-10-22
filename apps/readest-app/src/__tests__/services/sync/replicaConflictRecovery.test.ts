import { describe, expect, test, vi } from 'vitest';
import { HlcGenerator, hlcPack } from '@/libs/crdt';
import {
  listRecoverableFields,
  restoreReplicaField,
  type ReplicaConflictVersion,
  type RestoreFieldRequest,
} from '@/services/sync/replicaConflictRecovery';
import type { ReplicaRow } from '@/types/replica';

const old = hlcPack(1_700_000_000_000, 0, 'a');
const newer = hlcPack(1_700_000_000_100, 0, 'b');
const version: ReplicaConflictVersion = {
  user_id: 'account-a',
  kind: 'settings',
  replica_id: 'singleton',
  source: 'incoming',
  version_hash: 'a'.repeat(32),
  recorded_at: '2026-10-23T00:00:00Z',
  row_data: {
    fields_jsonb: {
      theme: { v: 'dark', t: old, s: 'a' },
      'readwise.accessToken': { v: 'private-token', t: old, s: 'a' },
      apiKey: { v: 'legacy-plain-key', t: old, s: 'a' },
      cipher: { v: { c: 'secret', i: 'nonce', s: 'salt', alg: 'aes', h: 'hash' }, t: old, s: 'a' },
    },
  },
};

const current = (): ReplicaRow => ({
  user_id: 'account-a',
  kind: 'settings',
  replica_id: 'singleton',
  fields_jsonb: { theme: { v: 'light', t: newer, s: 'b' } },
  manifest_jsonb: null,
  deleted_at_ts: null,
  reincarnation: null,
  updated_at_ts: newer,
  schema_version: 1,
});

describe('replica conflict recovery', () => {
  test('shows safe previews but never exposes credential values', () => {
    const fields = listRecoverableFields(version);
    expect(fields.find((field) => field.name === 'theme')).toMatchObject({
      preview: 'dark',
      restorable: true,
    });
    expect(fields.find((field) => field.name === 'readwise.accessToken')).toMatchObject({
      preview: 'Protected value',
      restorable: false,
    });
    expect(fields.find((field) => field.name === 'apiKey')).toMatchObject({
      preview: 'Protected value',
      restorable: false,
    });
    expect(fields.find((field) => field.name === 'cipher')).toMatchObject({
      preview: 'Protected value',
      restorable: false,
    });
    expect(JSON.stringify(fields)).not.toContain('private-token');
    expect(JSON.stringify(fields)).not.toContain('legacy-plain-key');
    expect(JSON.stringify(fields)).not.toContain('secret');
  });

  test('restores one field with a clock newer than the current winner', async () => {
    const row = current();
    const restore = vi.fn(async (_request: RestoreFieldRequest) => row);
    const fetchCurrent = vi.fn(async () => row);
    const hlc = new HlcGenerator('restore-device', () => 1_700_000_000_050);
    await restoreReplicaField(version, 'theme', 'account-a', hlc, { fetchCurrent, restore });
    expect(fetchCurrent).toHaveBeenCalledWith('account-a', 'settings', 'singleton');
    expect(restore).toHaveBeenCalledWith(
      expect.objectContaining({
        p_user_id: 'account-a',
        p_field: 'theme',
        p_expected_current: row.fields_jsonb['theme'],
        p_version_hash: version.version_hash,
        p_source: 'incoming',
        p_new_hlc: expect.any(String),
      }),
    );
    const request = restore.mock.calls[0]?.[0];
    expect(request).toBeDefined();
    expect(request!.p_new_hlc > newer).toBe(true);
  });

  test('rejects another account, protected field, or deleted current row', async () => {
    const restore = vi.fn(async () => current());
    const fetchCurrent = vi.fn(async () => current());
    const hlc = new HlcGenerator('restore-device');
    const transport = { fetchCurrent, restore };
    await expect(
      restoreReplicaField(version, 'theme', 'account-b', hlc, transport),
    ).rejects.toThrow();
    await expect(
      restoreReplicaField(version, 'readwise.accessToken', 'account-a', hlc, transport),
    ).rejects.toThrow();
    expect(fetchCurrent).not.toHaveBeenCalled();
    await expect(
      restoreReplicaField(version, 'theme', 'account-a', hlc, {
        fetchCurrent: async () => ({ ...current(), deleted_at_ts: newer }),
        restore,
      }),
    ).rejects.toThrow();
    expect(restore).not.toHaveBeenCalled();
  });
});
