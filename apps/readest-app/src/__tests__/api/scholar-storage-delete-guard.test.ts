import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const validateUserAndToken = vi.fn();
const createSupabaseAdminClient = vi.fn();
const deleteObject = vi.fn();
const scholarRelease = { active: true };

vi.mock('@/utils/cors', () => ({ corsAllMethods: {}, runMiddleware: vi.fn() }));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...args: unknown[]) => validateUserAndToken(...args),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: (...args: unknown[]) => createSupabaseAdminClient(...args),
}));
vi.mock('@/utils/object', () => ({
  deleteObject: (...args: unknown[]) => deleteObject(...args),
}));
vi.mock('@/services/environment', () => ({
  isScholarReleaseBundle: () => scholarRelease.active,
}));

import removeOne from '@/pages/api/storage/delete';
import removeMany from '@/pages/api/storage/purge';
import { isProtectedScholarStorageKey } from '@/utils/scholarProtectedFile';

const userId = '00000000-0000-4000-8000-000000000001';
const fileId = '00000000-0000-4000-8000-000000000002';
const bookKey = userId + '/Readest/Books/hash/Paper.pdf';
const coverKey = userId + '/Readest/Books/hash/cover.png';
const request = (method: string, query: Record<string, unknown> = {}, body: unknown = {}) => ({
  req: { method, query, body, headers: { authorization: 'Bearer token' } } as unknown as NextApiRequest,
  res: { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as NextApiResponse,
});

beforeEach(() => {
  scholarRelease.active = true;
  validateUserAndToken.mockReset().mockResolvedValue({ user: { id: userId }, token: 'token' });
  createSupabaseAdminClient.mockReset();
  deleteObject.mockReset().mockResolvedValue(undefined);
});

describe('Scholar storage delete guard', () => {
  it('protects Scholar book objects and immutable versions only under their owner prefix', () => {
    expect(isProtectedScholarStorageKey(bookKey, userId)).toBe(true);
    expect(isProtectedScholarStorageKey(coverKey, userId)).toBe(true);
    expect(isProtectedScholarStorageKey(userId + '/Scholar/versions/version', userId)).toBe(true);
    expect(isProtectedScholarStorageKey('other/' + bookKey, userId)).toBe(false);
    scholarRelease.active = false;
    expect(isProtectedScholarStorageKey(bookKey, userId)).toBe(false);
  });

  it('rejects a single Scholar book deletion before touching object storage', async () => {
    const { req, res } = request('DELETE', { fileKey: bookKey });
    await removeOne(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('rejects a mixed bulk purge before deleting any objects', async () => {
    const { req, res } = request('DELETE', {}, { fileKeys: [userId + '/other.bin', bookKey] });
    await removeMany(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('keeps generic deletion working on an older server without the version table', async () => {
    scholarRelease.active = false;
    const fileQuery: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'limit']) fileQuery[method] = vi.fn().mockReturnValue(fileQuery);
    fileQuery['single'] = vi.fn().mockResolvedValue({ data: { id: fileId, user_id: userId }, error: null });
    const versionQuery: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'limit']) versionQuery[method] = vi.fn().mockReturnValue(versionQuery);
    versionQuery['maybeSingle'] = vi.fn().mockResolvedValue({ data: null, error: { code: '42P01' } });
    const fileDelete = { delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }) };
    let filesReads = 0;
    createSupabaseAdminClient.mockReturnValue({
      from: vi.fn((name: string) => name === 'files'
        ? (filesReads++ === 0 ? fileQuery : fileDelete) : versionQuery),
    });
    const { req, res } = request('DELETE', { fileKey: bookKey });
    await removeOne(req, res);
    expect(deleteObject).toHaveBeenCalledWith(bookKey);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('also blocks retained versions when a server lacks the Scholar release flag', async () => {
    scholarRelease.active = false;
    const fileQuery: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'limit']) fileQuery[method] = vi.fn().mockReturnValue(fileQuery);
    fileQuery['single'] = vi.fn().mockResolvedValue({ data: { id: fileId, user_id: userId }, error: null });
    const versionQuery: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'limit']) versionQuery[method] = vi.fn().mockReturnValue(versionQuery);
    versionQuery['maybeSingle'] = vi.fn().mockResolvedValue({ data: { file_id: fileId }, error: null });
    createSupabaseAdminClient.mockReturnValue({
      from: vi.fn((name: string) => name === 'files' ? fileQuery : versionQuery),
    });
    const { req, res } = request('DELETE', { fileKey: bookKey });
    await removeOne(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
