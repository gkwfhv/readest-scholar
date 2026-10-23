import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const validateUserAndToken = vi.fn();
const createSupabaseClient = vi.fn();
vi.mock('@/utils/cors', () => ({ corsAllMethods: {}, runMiddleware: vi.fn() }));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...args: unknown[]) => validateUserAndToken(...args),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseClient: (...args: unknown[]) => createSupabaseClient(...args),
}));
vi.mock('@/utils/object', () => ({ isSafeObjectKeyName: () => true }));

import removeScholarFile from '@/pages/api/scholar/files/delete';

const userId = '00000000-0000-4000-8000-000000000001';
const fileId = '00000000-0000-4000-8000-000000000002';
const opId = '00000000-0000-4000-8000-000000000003';
const headId = '00000000-0000-4000-8000-000000000004';
const body = {
  fileName: 'Readest/Books/hash/Paper.pdf',
  opId,
  expectedVersionId: headId,
};
const request = (method: string, input: unknown = body) => ({
  req: { method, body: input, headers: { authorization: 'Bearer token' } } as unknown as NextApiRequest,
  res: { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as NextApiResponse,
});

beforeEach(() => {
  validateUserAndToken.mockReset().mockResolvedValue({ user: { id: userId }, token: 'token' });
  createSupabaseClient.mockReset();
});

describe('Scholar file delete API', () => {
  it('soft-deletes the exact owned path with an operation ID and reviewed head', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ file_id: fileId, active_version_id: headId, deleted_at: '2026-10-23T00:00:00Z' }],
      error: null,
    });
    createSupabaseClient.mockReturnValue({ rpc });
    const { req, res } = request('POST');
    await removeScholarFile(req, res);
    expect(createSupabaseClient).toHaveBeenCalledWith('token');
    expect(rpc).toHaveBeenCalledWith('delete_scholar_file_v1', {
      p_file_key: userId + '/' + body.fileName,
      p_op_id: opId,
      p_expected_version_id: headId,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      fileId, activeVersionId: headId, deletedAt: '2026-10-23T00:00:00Z',
    });
  });

  it('surfaces a concurrent new head as a conflict', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'PT409' } });
    createSupabaseClient.mockReturnValue({ rpc });
    const { req, res } = request('POST');
    await removeScholarFile(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Scholar delete conflict; remote version retained',
    });
  });

  it('rejects an anonymous or malformed request before database access', async () => {
    const malformed = request('POST', { ...body, fileName: 'Readest/Books/hash/other/deep.pdf' });
    await removeScholarFile(malformed.req, malformed.res);
    expect(malformed.res.status).toHaveBeenCalledWith(400);
    validateUserAndToken.mockResolvedValue({});
    const anonymous = request('POST');
    await removeScholarFile(anonymous.req, anonymous.res);
    expect(anonymous.res.status).toHaveBeenCalledWith(403);
    expect(createSupabaseClient).not.toHaveBeenCalled();
  });
});
