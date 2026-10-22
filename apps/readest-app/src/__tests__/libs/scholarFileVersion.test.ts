import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAccessToken = vi.fn();
const sha256File = vi.fn();
const webUpload = vi.fn();
vi.mock('@/services/environment', () => ({ getAPIBaseUrl: () => 'https://api.test' }));
vi.mock('@/utils/access', () => ({
  getAccessToken: (...args: unknown[]) => getAccessToken(...args),
}));
vi.mock('@/services/dictionaries/plugins/integrity', () => ({
  sha256File: (...args: unknown[]) => sha256File(...args),
}));
vi.mock('@/utils/transfer', () => ({ webUpload: (...args: unknown[]) => webUpload(...args) }));

import { uploadScholarFileVersion } from '@/libs/scholarFileVersion';

const fileId = '00000000-0000-4000-8000-000000000001';
const opId = '00000000-0000-4000-8000-000000000002';
const versionId = '00000000-0000-4000-8000-000000000003';
const file = new File(['scholar-version'], 'paper.pdf', { type: 'application/pdf' });
const originalFetch = globalThis.fetch;
const response = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  getAccessToken.mockReset().mockResolvedValue('tok');
  sha256File.mockReset().mockResolvedValue('a'.repeat(64));
  webUpload.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('uploadScholarFileVersion', () => {
  it('hashes in chunks, uploads with create-only header, and completes one operation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          state: 'pending',
          versionId,
          uploadUrl: 'https://object.test/put',
          headers: { 'If-None-Match': '*' },
        }),
      )
      .mockResolvedValueOnce(
        response(200, { versionId, applied: true, activeVersionId: versionId }),
      );
    globalThis.fetch = fetchMock;
    const result = await uploadScholarFileVersion(file, fileId, opId, null);
    expect(sha256File).toHaveBeenCalledWith(file);
    expect(webUpload).toHaveBeenCalledWith(file, 'https://object.test/put', undefined, {
      'If-None-Match': '*',
    });
    const firstBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body);
    expect(firstBody).toEqual({ fileId, opId, fileSize: file.size, sha256: 'a'.repeat(64) });
    expect(fetchMock.mock.calls[0]![1]!.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'X-Scholar-Protocol': '1',
    });
    expect(result).toEqual({ versionId, applied: true, activeVersionId: versionId });
  });

  it('completes after a lost PUT response if the server verifies the object', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          state: 'pending',
          versionId,
          uploadUrl: 'https://object.test/put',
          headers: { 'If-None-Match': '*' },
        }),
      )
      .mockResolvedValueOnce(
        response(200, { versionId, applied: true, activeVersionId: versionId }),
      );
    webUpload.mockRejectedValue(new Error('Upload failed with status 412'));
    await expect(uploadScholarFileVersion(file, fileId, opId, null)).resolves.toEqual({
      versionId,
      applied: true,
      activeVersionId: versionId,
    });
  });

  it('returns a retained losing version after a compare-and-swap conflict', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          state: 'pending',
          versionId,
          uploadUrl: 'https://object.test/put',
          headers: { 'If-None-Match': '*' },
        }),
      )
      .mockResolvedValueOnce(response(409, { versionId, applied: false, activeVersionId: opId }));
    await expect(uploadScholarFileVersion(file, fileId, opId, null)).resolves.toEqual({
      versionId,
      applied: false,
      activeVersionId: opId,
    });
  });

  it('keeps an incomplete upload as an error for retry with the same operation id', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          state: 'pending',
          versionId,
          uploadUrl: 'https://object.test/put',
          headers: { 'If-None-Match': '*' },
        }),
      )
      .mockResolvedValueOnce(response(409, { error: 'Upload incomplete' }));
    webUpload.mockRejectedValue(new Error('connection lost'));
    await expect(uploadScholarFileVersion(file, fileId, opId, null)).rejects.toThrow(
      'connection lost',
    );
  });
});
