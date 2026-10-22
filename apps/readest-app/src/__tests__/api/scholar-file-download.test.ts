import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const validateUserAndToken = vi.fn();
const createSupabaseAdminClient = vi.fn();
const getDownloadSignedUrl = vi.fn();
vi.mock('@/utils/cors', () => ({
  corsAllMethods: {},
  runMiddleware: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...args: unknown[]) => validateUserAndToken(...args),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: (...args: unknown[]) => createSupabaseAdminClient(...args),
}));
vi.mock('@/utils/object', () => ({
  getDownloadSignedUrl: (...args: unknown[]) => getDownloadSignedUrl(...args),
}));
import handler from '@/pages/api/scholar/files/download';

const userId = '00000000-0000-4000-8000-000000000001';
const fileId = '00000000-0000-4000-8000-000000000002';
const versionId = '00000000-0000-4000-8000-000000000003';
const objectKey = `${userId}/Scholar/versions/${versionId}`;
const request = (query: Record<string, unknown>) => ({
  req: {
    method: 'GET',
    headers: { authorization: 'Bearer tok' },
    query,
  } as unknown as NextApiRequest,
  res: {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as NextApiResponse,
});
const table = (result: unknown) => {
  const chain: Record<string, unknown> = { single: vi.fn().mockResolvedValue(result) };
  for (const method of ['select', 'eq']) chain[method] = () => chain;
  return chain;
};

beforeEach(() => {
  validateUserAndToken.mockReset().mockResolvedValue({ user: { id: userId }, token: 'tok' });
  createSupabaseAdminClient.mockReset();
  getDownloadSignedUrl.mockReset().mockResolvedValue('https://example.invalid/download');
});

describe('Scholar file version download', () => {
  it('signs only the active ready version owned by the caller', async () => {
    const heads = table({ data: { version_id: versionId }, error: null });
    const versions = table({
      data: { version_id: versionId, object_key: objectKey, sha256: 'a'.repeat(64), file_size: 11 },
      error: null,
    });
    const from = vi.fn((name: string) => (name === 'scholar_file_heads' ? heads : versions));
    createSupabaseAdminClient.mockReturnValue({ from });
    const { req, res } = request({ fileId });
    await handler(req, res);
    expect(from).toHaveBeenCalledWith('scholar_file_heads');
    expect(from).toHaveBeenCalledWith('scholar_file_versions');
    expect(getDownloadSignedUrl).toHaveBeenCalledWith(objectKey, 300);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ versionId }));
  });

  it('does not sign an unready or foreign version', async () => {
    const from = vi.fn().mockReturnValue(table({ data: null, error: { code: 'PGRST116' } }));
    createSupabaseAdminClient.mockReturnValue({ from });
    const { req, res } = request({ fileId, versionId });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(getDownloadSignedUrl).not.toHaveBeenCalled();
  });

  it('denies unauthenticated download before touching service-role tables', async () => {
    validateUserAndToken.mockResolvedValue({});
    const { req, res } = request({ fileId });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });
});
