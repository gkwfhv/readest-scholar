import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { hlcPack } from '@/libs/crdt';
import type { ReplicaRow } from '@/types/replica';

const rpc = vi.fn();
vi.mock('@/utils/supabase', () => ({ createSupabaseClient: () => ({ rpc }) }));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: async () => ({ user: { id: 'account-a' }, token: 'synthetic' }),
}));
vi.mock('@/utils/cors', () => ({
  runMiddleware: async () => undefined,
  corsAllMethods: () => undefined,
}));

import { POST } from '@/pages/api/sync/replicas';

const makeRow = (): ReplicaRow => {
  const t = hlcPack(Date.now(), 0, 'test-device');
  return {
    user_id: 'account-a',
    kind: 'settings',
    replica_id: 'singleton',
    fields_jsonb: { theme: { v: 'dark', t, s: 'test-device' } },
    manifest_jsonb: null,
    deleted_at_ts: null,
    reincarnation: null,
    updated_at_ts: t,
    schema_version: 1,
  };
};

const push = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/sync/replicas', {
      method: 'POST',
      headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  rpc.mockReset();
  rpc.mockReturnValue({ single: async () => ({ data: makeRow(), error: null }) });
});

describe('POST /api/sync/replicas protocol selection', () => {
  test('version 2 uses the conflict-preserving merge RPC', async () => {
    const response = await push({ protocolVersion: 2, rows: [makeRow()] });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('crdt_merge_replica_v2', expect.any(Object));
  });

  test('legacy requests keep the old merge RPC', async () => {
    const response = await push({ rows: [makeRow()] });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('crdt_merge_replica', expect.any(Object));
  });
});
