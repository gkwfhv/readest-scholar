import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const rpc = vi.fn();
const auth = vi.fn();
vi.mock('@/utils/supabase', () => ({ createSupabaseClient: () => ({ rpc }) }));
vi.mock('@/utils/access', () => ({ validateUserAndToken: (...args: unknown[]) => auth(...args) }));
vi.mock('@/utils/cors', () => ({
  runMiddleware: async () => undefined,
  corsAllMethods: () => undefined,
}));

import handler from '@/pages/api/sync/replica-changes';

const response = () => {
  const res = {
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
};

const request = (url: string) =>
  ({
    method: 'GET',
    url,
    headers: { authorization: 'Bearer synthetic' },
  }) as unknown as NextApiRequest;

beforeEach(() => {
  rpc.mockReset();
  auth.mockReset();
  auth.mockResolvedValue({ user: { id: 'account-a' }, token: 'synthetic' });
});

describe('GET /api/sync/replica-changes', () => {
  test('passes an exact decimal cursor to the RPC and returns a bounded page', async () => {
    rpc.mockResolvedValue({
      data: [
        { seq: '9007199254740993', row_data: { replica_id: 'a' } },
        { seq: '9007199254740994', row_data: { replica_id: 'b' } },
      ],
      error: null,
    });
    const res = response();
    await handler(
      request('/api/sync/replica-changes?kind=dictionary&after=9007199254740992&limit=1'),
      res as unknown as NextApiResponse,
    );
    expect(rpc).toHaveBeenCalledWith('replica_changes_page', {
      p_kind: 'dictionary',
      p_after: '9007199254740992',
      p_limit: 2,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      changes: [{ seq: '9007199254740993', row: { replica_id: 'a' } }],
      nextCursor: '9007199254740993',
      hasMore: true,
    });
  });

  test('rejects an invalid cursor before querying the database', async () => {
    const res = response();
    await handler(
      request('/api/sync/replica-changes?kind=dictionary&after=9007199254740993.5'),
      res as unknown as NextApiResponse,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  test('rejects unauthenticated requests before querying the database', async () => {
    auth.mockResolvedValue({ user: null, token: null });
    const res = response();
    await handler(
      request('/api/sync/replica-changes?kind=dictionary'),
      res as unknown as NextApiResponse,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});
