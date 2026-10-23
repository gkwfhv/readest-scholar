import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
const rpc = vi.fn();
const from = vi.fn();
vi.mock('@/utils/cors', () => ({ corsAllMethods: {}, runMiddleware: vi.fn() }));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: vi.fn().mockResolvedValue({ user: { id: 'user-id' }, token: 'tok' }),
  getStoragePlanData: vi.fn().mockReturnValue({ quota: 100 }),
}));
vi.mock('@/utils/supabase', () => ({ createSupabaseAdminClient: () => ({ rpc, from }) }));
import handler from '@/pages/api/storage/stats';
const request = () => {
  const req = {
    method: 'GET',
    headers: { authorization: 'Bearer tok' },
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
});
describe('storage usage with retained Scholar versions', () => {
  it('reports all live bytes in the quota and separates immutable version bytes', async () => {
    rpc.mockImplementation(async (name: string) =>
      name === 'get_storage_usage_v1'
        ? {
            data: [
              {
                file_count: 1,
                file_bytes: 20,
                version_count: 2,
                version_bytes: 70,
                usage_bytes: 90,
              },
            ],
            error: null,
          }
        : { data: [{ bookHash: 'book', fileCount: 1, totalSize: 20 }], error: null },
    );
    const { req, res } = request();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(rpc).toHaveBeenCalledWith('get_storage_usage_v1', { p_user_id: 'user-id' });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        totalFiles: 1,
        totalSize: 20,
        versionCount: 2,
        versionBytes: 70,
        usage: 90,
        usagePercentage: 90,
      }),
    );
    expect(from).not.toHaveBeenCalled();
  });
});
