import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const validateUserAndToken = vi.fn();
const createSupabaseAdminClient = vi.fn();
const createSupabaseClient = vi.fn();
vi.mock('@/utils/cors', () => ({ corsAllMethods: {}, runMiddleware: vi.fn() }));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...args: unknown[]) => validateUserAndToken(...args),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: (...args: unknown[]) => createSupabaseAdminClient(...args),
  createSupabaseClient: (...args: unknown[]) => createSupabaseClient(...args),
}));

import history from '@/pages/api/scholar/files/history';
import restore from '@/pages/api/scholar/files/restore';

const userId = '00000000-0000-4000-8000-000000000001';
const fileId = '00000000-0000-4000-8000-000000000002';
const versionId = '00000000-0000-4000-8000-000000000003';
const activeId = '00000000-0000-4000-8000-000000000004';
const opId = '00000000-0000-4000-8000-000000000005';
const request = (
  method: string,
  query: Record<string, unknown> = {},
  body: Record<string, unknown> = {},
) => ({
  req: {
    method,
    query,
    body,
    headers: { authorization: 'Bearer tok' },
  } as unknown as NextApiRequest,
  res: {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as NextApiResponse,
});
const query = (result: unknown, final: 'maybeSingle' | 'limit' = 'maybeSingle') => {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'order'])
    chain[method] = vi.fn().mockReturnValue(chain);
  chain[final] = vi.fn().mockResolvedValue(result);
  return chain;
};

beforeEach(() => {
  validateUserAndToken.mockReset().mockResolvedValue({ user: { id: userId }, token: 'tok' });
  createSupabaseAdminClient.mockReset();
  createSupabaseClient.mockReset();
});

describe('Scholar file version history and restore', () => {
  it('lists only ready versions for an owned live Scholar document', async () => {
    const files = query({ data: { id: fileId }, error: null });
    const linked = query({ data: { file_id: fileId }, error: null });
    const head = query({ data: { version_id: activeId }, error: null });
    const versions = query(
      {
        data: [
          {
            version_id: versionId,
            op_id: opId,
            sha256: 'a'.repeat(64),
            file_size: 3,
            verified_at: '2026-10-23T00:00:00Z',
          },
        ],
        error: null,
      },
      'limit',
    );
    const from = vi.fn(
      (name: string) =>
        ({
          files,
          scholar_document_files: linked,
          scholar_file_heads: head,
          scholar_file_versions: versions,
        })[name],
    );
    createSupabaseAdminClient.mockReturnValue({ from });
    const { req, res } = request('GET', { fileId });
    await history(req, res);
    expect(files['eq']).toHaveBeenCalledWith('user_id', userId);
    expect(files['is']).toHaveBeenCalledWith('deleted_at', null);
    expect(linked['eq']).toHaveBeenCalledWith('user_id', userId);
    expect(versions['eq']).toHaveBeenCalledWith('state', 'ready');
    expect(versions['limit']).toHaveBeenCalledWith(100);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      fileId,
      activeVersionId: activeId,
      versions: [
        {
          versionId,
          opId,
          sha256: 'a'.repeat(64),
          fileSize: 3,
          verifiedAt: '2026-10-23T00:00:00Z',
        },
      ],
    });
  });

  it('can find an older conflicting upload by operation ID', async () => {
    const versions = query(
      {
        data: [
          {
            version_id: versionId,
            op_id: opId,
            sha256: 'b'.repeat(64),
            file_size: 4,
            verified_at: '2026-10-22T00:00:00Z',
          },
        ],
        error: null,
      },
      'limit',
    );
    const from = vi.fn((name: string) =>
      name === 'scholar_file_versions'
        ? versions
        : query({
            data:
              name === 'scholar_file_heads'
                ? { version_id: activeId }
                : name === 'files'
                  ? { id: fileId }
                  : { file_id: fileId },
            error: null,
          }),
    );
    createSupabaseAdminClient.mockReturnValue({ from });
    const { req, res } = request('GET', { fileId, opId });
    await history(req, res);
    expect(versions['eq']).toHaveBeenCalledWith('op_id', opId);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not list a file without account ownership and Scholar link', async () => {
    const from = vi.fn((name: string) =>
      name === 'files'
        ? query({ data: { id: fileId }, error: null })
        : query({ data: null, error: null }),
    );
    createSupabaseAdminClient.mockReturnValue({ from });
    const { req, res } = request('GET', { fileId });
    await history(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(from).not.toHaveBeenCalledWith('scholar_file_versions');
  });

  it('rejects a stale head during restore without altering it', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'PT409' } });
    createSupabaseClient.mockReturnValue({ rpc });
    const { req, res } = request('POST', {}, { fileId, versionId, expectedVersionId: activeId });
    await restore(req, res);
    expect(createSupabaseClient).toHaveBeenCalledWith('tok');
    expect(rpc).toHaveBeenCalledWith('restore_scholar_file_version_v1', {
      p_file_id: fileId,
      p_version_id: versionId,
      p_expected_version_id: activeId,
    });
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('returns the new active version after an authorized restore', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { version_id: versionId }, error: null });
    createSupabaseClient.mockReturnValue({ rpc });
    const { req, res } = request('POST', {}, { fileId, versionId, expectedVersionId: activeId });
    await restore(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ activeVersionId: versionId });
  });

  it('rejects invalid IDs and anonymous requests before database access', async () => {
    const invalid = request('POST', {}, { fileId, versionId: 'bad', expectedVersionId: activeId });
    await restore(invalid.req, invalid.res);
    expect(invalid.res.status).toHaveBeenCalledWith(400);
    validateUserAndToken.mockResolvedValue({});
    const anonymous = request('GET', { fileId });
    await history(anonymous.req, anonymous.res);
    expect(anonymous.res.status).toHaveBeenCalledWith(403);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(createSupabaseClient).not.toHaveBeenCalled();
  });
});
