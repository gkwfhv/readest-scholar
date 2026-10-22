import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
const from = vi.fn();
const validate = vi.fn();
vi.mock('@/utils/cors', () => ({ corsAllMethods: {}, runMiddleware: vi.fn() }));
vi.mock('@/utils/access', () => ({ validateUserAndToken: (...args: unknown[]) => validate(...args) }));
vi.mock('@/utils/supabase', () => ({ createSupabaseAdminClient: () => ({ from }) }));
import handler from '@/pages/api/scholar/files/status';
const userId = '00000000-0000-4000-8000-000000000001';
const fileId = '00000000-0000-4000-8000-000000000002';
const versionId = '00000000-0000-4000-8000-000000000003';
const fileKey = `${userId}/Readest/Books/hash/paper.pdf`;
const makeReqRes = (key: string) => ({
  req: { method: 'GET', headers: { authorization: 'Bearer tok' }, query: { fileKey: key } } as unknown as NextApiRequest,
  res: { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as NextApiResponse,
});
const chain = (data: unknown) => {
  const q: Record<string, unknown> = {};
  for (const op of ['select','eq','is']) q[op] = () => q;
  q['maybeSingle'] = vi.fn().mockResolvedValue({ data, error: null });
  return q;
};
beforeEach(() => {
  from.mockReset(); validate.mockReset().mockResolvedValue({ user: { id: userId }, token: 'tok' });
});
describe('Scholar file status', () => {
  it('returns owned linked file and its active immutable version', async () => {
    from.mockImplementation((table: string) => chain(table === 'files' ? { id: fileId }
      : table === 'scholar_document_files' ? { file_id: fileId } : { version_id: versionId }));
    const { req, res } = makeReqRes(fileKey); await handler(req,res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ fileId, activeVersionId: versionId });
  });
  it('reports null version for a linked legacy file', async () => {
    from.mockImplementation((table: string) => chain(table === 'files' ? { id: fileId }
      : table === 'scholar_document_files' ? { file_id: fileId } : null));
    const { req, res } = makeReqRes(fileKey); await handler(req,res);
    expect(res.json).toHaveBeenCalledWith({ fileId, activeVersionId: null });
  });
  it('does not reveal a different account file', async () => {
    const { req, res } = makeReqRes(`other-account/Readest/Books/hash/paper.pdf`);
    await handler(req,res);
    expect(res.status).toHaveBeenCalledWith(404); expect(from).not.toHaveBeenCalled();
  });
  it('does not resolve a file outside Scholar document mapping', async () => {
    from.mockImplementation((table: string) => chain(table === 'files' ? { id: fileId } : null));
    const { req, res } = makeReqRes(fileKey); await handler(req,res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
