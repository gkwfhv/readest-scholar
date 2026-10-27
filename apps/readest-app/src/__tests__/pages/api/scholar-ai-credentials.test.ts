import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const state = vi.hoisted(() => ({
  account: '00000000-0000-4000-8000-000000000001',
  rows: new Map<string, Record<string, string>>(),
  key: Buffer.alloc(32, 7),
  keyAvailable: true,
}));
vi.mock('@/utils/cors', () => ({ corsAllMethods: {}, runMiddleware: vi.fn() }));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: vi.fn(async () =>
    state.account
      ? { user: { id: state.account }, token: 'test-token' }
      : { user: null, token: null },
  ),
}));
vi.mock('@/server/scholarAiVault', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/scholarAiVault')>()),
  readAiVaultKey: () => {
    if (!state.keyAvailable) throw new Error('no key');
    return state.key;
  },
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: () => {
      const query: Record<string, unknown> = {};
      let owner = '';
      let kind = '';
      query['select'] = () => query;
      query['eq'] = (field: string, value: string) => {
        if (field === 'user_id') owner = value;
        if (field === 'kind') kind = value;
        return query;
      };
      query['then'] = (resolve: (value: unknown) => void) =>
        resolve({
          data: [...state.rows.entries()]
            .filter(([id]) => id.startsWith(`${owner}:`))
            .map(([, row]) => row),
          error: null,
        });
      query['upsert'] = async (row: Record<string, string>) => {
        state.rows.set(`${row['user_id']}:${row['kind']}`, row);
        return { error: null };
      };
      query['delete'] = () => {
        query['then'] = (resolve: (value: unknown) => void) => {
          state.rows.delete(`${owner}:${kind}`);
          resolve({ error: null });
        };
        return query;
      };
      return query;
    },
  }),
}));

import handler from '@/pages/api/scholar/ai/credentials';
const alice = '00000000-0000-4000-8000-000000000001';
const bob = '00000000-0000-4000-8000-000000000002';
function makeReqRes(method: string, body: unknown = {}) {
  const req = { method, body, headers: { authorization: 'Bearer test-token' } } as NextApiRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  } as unknown as NextApiResponse;
  return { req, res };
}
async function call(method: string, body?: unknown) {
  const { req, res } = makeReqRes(method, body);
  await handler(req, res);
  return res;
}
beforeEach(() => {
  state.account = alice;
  state.rows.clear();
  state.key = randomBytes(32);
  state.keyAvailable = true;
});

describe('Scholar AI credential API', () => {
  it('never allows browser caching and rejects unsupported methods', async () => {
    const read = await call('GET');
    expect(read.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect((await call('POST')).status).toHaveBeenCalledWith(405);
  });
  it('stores ciphertext and returns the key only to its owner', async () => {
    const saved = await call('PUT', { kind: 'openrouterApiKey', value: 'synthetic-key' });
    expect(saved.status).toHaveBeenCalledWith(200);
    expect(JSON.stringify([...state.rows.values()])).not.toContain('synthetic-key');
    const read = await call('GET');
    expect(read.json).toHaveBeenCalledWith({ openrouterApiKey: 'synthetic-key' });
    state.account = bob;
    const other = await call('GET');
    expect(other.json).toHaveBeenCalledWith({});
  });
  it('rejects anonymous use and invalid fields without writing', async () => {
    state.account = '';
    expect((await call('GET')).status).toHaveBeenCalledWith(403);
    state.account = alice;
    expect((await call('PUT', { kind: 'other', value: 'x' })).status).toHaveBeenCalledWith(400);
    expect(state.rows.size).toBe(0);
  });
  it('fails closed when the vault key is unavailable', async () => {
    state.keyAvailable = false;
    expect(
      (await call('PUT', { kind: 'aiGatewayApiKey', value: 'x' })).status,
    ).toHaveBeenCalledWith(503);
    expect(state.rows.size).toBe(0);
  });
  it('clears a field and refuses tampered ciphertext', async () => {
    await call('PUT', { kind: 'aiGatewayApiKey', value: 'temporary' });
    const row = state.rows.get(`${alice}:aiGatewayApiKey`)!;
    row['ciphertext'] = Buffer.from('tampered').toString('base64');
    expect((await call('GET')).status).toHaveBeenCalledWith(500);
    expect((await call('PUT', { kind: 'aiGatewayApiKey', value: '' })).status).toHaveBeenCalledWith(
      200,
    );
    expect(state.rows.size).toBe(0);
  });
});
