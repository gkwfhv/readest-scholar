import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
const rpc = vi.fn();
const validate = vi.fn();
vi.mock('@/utils/cors', () => ({ corsAllMethods: {}, runMiddleware: vi.fn() }));
vi.mock('@/utils/access', () => ({ validateUserAndToken: (...args: unknown[]) => validate(...args) }));
vi.mock('@/utils/supabase', () => ({ createSupabaseAdminClient: () => ({ rpc }) }));
import handler from '@/pages/api/scholar/files/register';
const userId = '00000000-0000-4000-8000-000000000001';
const fileId = '00000000-0000-4000-8000-000000000002';
const request = (fileName = 'Readest/Books/hash/paper.pdf', bookHash = 'hash') => ({
  req: { method: 'POST', headers: { authorization: 'Bearer tok' }, body: { fileName, bookHash } } as unknown as NextApiRequest,
  res: { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as NextApiResponse,
});
beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: [{ file_id: fileId, active_version_id: null }], error: null });
  validate.mockReset().mockResolvedValue({ user: { id: userId }, token: 'tok' });
});
describe('Scholar file registration', () => {
  it('derives account identity and returns stable file ID without signing a legacy PUT', async () => {
    const { req, res } = request(); await handler(req,res);
    expect(rpc).toHaveBeenCalledWith('register_scholar_file_v1', {
      p_user_id: userId, p_file_key: `${userId}/Readest/Books/hash/paper.pdf`, p_book_hash: 'hash',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ fileId, activeVersionId: null });
  });
  it('rejects traversal and mismatched book paths before the database', async () => {
    for (const fileName of ['Readest/Books/hash/../paper.pdf','Readest/Books/other/paper.pdf']) {
      const { req, res } = request(fileName); await handler(req,res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it('maps a missing synced book to a retryable failure without creating a file', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PT404' } });
    const { req, res } = request(); await handler(req,res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
  it('rejects unauthenticated registration', async () => {
    validate.mockResolvedValue({});
    const { req, res } = request(); await handler(req,res);
    expect(res.status).toHaveBeenCalledWith(403); expect(rpc).not.toHaveBeenCalled();
  });
});
