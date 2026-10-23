import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const rpc = vi.fn();
const from = vi.fn();
const sign = vi.fn();
vi.mock('@/utils/cors', () => ({ corsAllMethods: {}, runMiddleware: vi.fn() }));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: vi
    .fn()
    .mockResolvedValue({ user: { id: '00000000-0000-4000-8000-000000000001' }, token: 'tok' }),
  getStoragePlanData: vi.fn().mockReturnValue({ usage: 0, quota: 100 }),
  STORAGE_QUOTA_GRACE_BYTES: 0,
}));
vi.mock('@/utils/object', async (orig) => ({
  ...(await orig<typeof import('@/utils/object')>()),
  getUploadSignedUrl: (...args: unknown[]) => sign(...args),
}));
vi.mock('@/utils/supabase', () => ({ createSupabaseAdminClient: () => ({ rpc, from }) }));
import handler from '@/pages/api/storage/upload';

const request = () => {
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer tok' },
    body: {
      fileName: 'Readest/Books/book.epub',
      fileSize: 11,
    },
  } as unknown as NextApiRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as NextApiResponse;
  return { req, res };
};

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  sign.mockReset().mockResolvedValue('https://object.test/put');
  const head = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  from.mockImplementation((table: string) => {
    if (table !== 'scholar_file_heads') throw Error('unexpected table: ' + table);
    return head;
  });
});

describe('legacy upload shared quota reservation', () => {
  it.each([
    -1,
    '11',
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid file size %s before reserving', async (fileSize) => {
    const { req, res } = request();
    req.body.fileSize = fileSize;
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('uses atomic database quota including immutable versions', async () => {
    rpc.mockResolvedValue({
      data: [{ file_id: 'file-1', object_size: 11, usage_bytes: 99 }],
      error: null,
    });
    const { req, res } = request();
    await handler(req, res);
    expect(rpc).toHaveBeenCalledWith(
      'reserve_storage_file_v1',
      expect.objectContaining({
        p_file_size: 11,
        p_quota_bytes: 100,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ usage: 99 }));
    expect(sign).toHaveBeenCalledWith(expect.stringContaining('Readest/Books/book.epub'), 11, 1800);
  });
  it('refuses the database quota rejection without signing', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'PT413', message: 'storage quota exceeded' },
    });
    const { req, res } = request();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(sign).not.toHaveBeenCalled();
  });
  it('refuses a stale client overwrite when a Scholar head exists', async () => {
    rpc.mockResolvedValue({
      data: [{ file_id: 'file-1', object_size: 11, usage_bytes: 99 }],
      error: null,
    });
    from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { version_id: 'v1' }, error: null }),
    });
    const { req, res } = request();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(sign).not.toHaveBeenCalled();
  });
});
