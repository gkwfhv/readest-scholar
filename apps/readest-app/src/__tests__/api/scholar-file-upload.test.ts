import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const validateUserAndToken = vi.fn();
const getStoragePlanData = vi.fn();
const createSupabaseAdminClient = vi.fn();
const getUploadSignedUrl = vi.fn();
const getObjectDigest = vi.fn();

vi.mock('@/utils/cors', () => ({
  corsAllMethods: {},
  runMiddleware: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...args: unknown[]) => validateUserAndToken(...args),
  getStoragePlanData: (...args: unknown[]) => getStoragePlanData(...args),
  STORAGE_QUOTA_GRACE_BYTES: 0,
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: (...args: unknown[]) => createSupabaseAdminClient(...args),
}));
vi.mock('@/utils/object', () => ({
  getUploadSignedUrl: (...args: unknown[]) => getUploadSignedUrl(...args),
}));
vi.mock('@/utils/objectDigest', () => ({
  getObjectDigest: (...args: unknown[]) => getObjectDigest(...args),
}));

import prepare from '@/pages/api/scholar/files/prepare';
import complete from '@/pages/api/scholar/files/complete';
import legacyDelete from '@/pages/api/storage/delete';
import legacyPurge from '@/pages/api/storage/purge';

const fileId = '00000000-0000-4000-8000-000000000001';
const opId = '00000000-0000-4000-8000-000000000002';
const versionId = '00000000-0000-4000-8000-000000000003';
const userId = '00000000-0000-4000-8000-000000000004';
const objectKey = `${userId}/Scholar/versions/${versionId}`;
const sha256 = 'a'.repeat(64);
const makeReqRes = (body: Record<string, unknown>) => {
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer tok' },
    body,
  } as unknown as NextApiRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as NextApiResponse;
  return { req, res };
};
const body = { fileId, opId, sha256, fileSize: 11 };

beforeEach(() => {
  validateUserAndToken.mockReset().mockResolvedValue({ user: { id: userId }, token: 'tok' });
  getStoragePlanData.mockReset().mockReturnValue({ quota: 1000 });
  getUploadSignedUrl.mockReset().mockResolvedValue('https://example.invalid/upload');
  getObjectDigest.mockReset().mockResolvedValue({ sha256, size: 11 });
  createSupabaseAdminClient.mockReset();
});

describe('Scholar immutable file API', () => {
  it('reserves trusted quota and signs a create-only PUT', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ version_id: versionId, object_key: objectKey, state: 'pending' }],
      error: null,
    });
    createSupabaseAdminClient.mockReturnValue({ rpc });
    const { req, res } = makeReqRes(body);
    await prepare(req, res);
    expect(rpc).toHaveBeenCalledWith('reserve_scholar_file_version_v1', {
      p_user_id: userId,
      p_file_id: fileId,
      p_op_id: opId,
      p_sha256: sha256,
      p_file_size: 11,
      p_quota_bytes: 1000,
    });
    expect(getUploadSignedUrl).toHaveBeenCalledWith(objectKey, 11, 300, undefined, true);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        versionId,
        uploadUrl: 'https://example.invalid/upload',
        headers: { 'If-None-Match': '*' },
      }),
    );
  });

  it('does not reserve for an unverified caller or malformed digest', async () => {
    const rpc = vi.fn();
    createSupabaseAdminClient.mockReturnValue({ rpc });
    const invalid = makeReqRes({ ...body, sha256: 'nope' });
    await prepare(invalid.req, invalid.res);
    expect(invalid.res.status).toHaveBeenCalledWith(400);
    expect(rpc).not.toHaveBeenCalled();
    validateUserAndToken.mockResolvedValue({});
    const anonymous = makeReqRes(body);
    await prepare(anonymous.req, anonymous.res);
    expect(anonymous.res.status).toHaveBeenCalledWith(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns quota refusal without signing an object URL', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'PT413' } });
    createSupabaseAdminClient.mockReturnValue({ rpc });
    const { req, res } = makeReqRes(body);
    await prepare(req, res);
    expect(res.status).toHaveBeenCalledWith(413);
    expect(getUploadSignedUrl).not.toHaveBeenCalled();
  });

  it('blocks legacy deletion of a protected Scholar version key', async () => {
    const single = makeReqRes({});
    single.req.method = 'DELETE';
    single.req.query = { fileKey: objectKey };
    await legacyDelete(single.req, single.res);
    expect(single.res.status).toHaveBeenCalledWith(400);

    const bulk = makeReqRes({ fileKeys: [objectKey] });
    bulk.req.method = 'DELETE';
    await legacyPurge(bulk.req, bulk.res);
    expect(bulk.res.status).toHaveBeenCalledWith(400);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('verifies stored bytes before completing the CAS', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { object_key: objectKey, sha256, file_size: 11, version_id: versionId },
      error: null,
    });
    const builder: Record<string, unknown> = { single };
    for (const method of ['select', 'eq']) builder[method] = () => builder;
    const rpc = vi.fn().mockResolvedValue({
      data: [{ applied: true, active_version_id: versionId }],
      error: null,
    });
    createSupabaseAdminClient.mockReturnValue({ from: () => builder, rpc });
    const { req, res } = makeReqRes({ fileId, opId, expectedVersionId: null });
    await complete(req, res);
    expect(getObjectDigest).toHaveBeenCalledWith(objectKey);
    expect(rpc).toHaveBeenCalledWith('complete_scholar_file_version_v1', {
      p_user_id: userId,
      p_file_id: fileId,
      p_op_id: opId,
      p_verified_sha256: sha256,
      p_verified_size: 11,
      p_expected_version_id: null,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects a byte mismatch without publishing the version', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { object_key: objectKey, sha256, file_size: 11, version_id: versionId },
      error: null,
    });
    const builder: Record<string, unknown> = { single };
    for (const method of ['select', 'eq']) builder[method] = () => builder;
    const rpc = vi.fn();
    createSupabaseAdminClient.mockReturnValue({ from: () => builder, rpc });
    getObjectDigest.mockResolvedValue({ sha256: 'b'.repeat(64), size: 11 });
    const { req, res } = makeReqRes({ fileId, opId, expectedVersionId: null });
    await complete(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(rpc).not.toHaveBeenCalled();
  });
});
