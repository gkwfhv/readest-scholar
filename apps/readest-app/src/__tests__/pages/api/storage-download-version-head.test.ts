import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();
const getDownloadSignedUrl = vi.fn();
vi.mock('@/utils/supabase', () => ({ createSupabaseAdminClient: () => ({ from }) }));
vi.mock('@/utils/object', () => ({
  getDownloadSignedUrl: (...args: unknown[]) => getDownloadSignedUrl(...args),
}));
import { processFileKeys } from '@/pages/api/storage/download';

const userId = '00000000-0000-4000-8000-000000000001';
const fileId = '00000000-0000-4000-8000-000000000002';
const versionId = '00000000-0000-4000-8000-000000000003';
const originalKey = `${userId}/Readest/Books/hash/hash.pdf`;
const versionKey = `${userId}/Scholar/versions/${versionId}`;

const query = (terminal: 'is' | 'in', result: unknown) => {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'limit']) chain[method] = () => chain;
  chain['in'] = () => (terminal === 'in' ? Promise.resolve(result) : chain);
  chain['is'] = () => (terminal === 'is' ? Promise.resolve(result) : chain);
  return chain;
};

beforeEach(() => {
  from.mockReset();
  getDownloadSignedUrl
    .mockReset()
    .mockImplementation(async (key: string) => `https://object.test/${key}`);
});

describe('legacy download alias for Scholar versions', () => {
  it('resolves the requested old key to its active immutable object', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'files')
        return query('is', {
          data: [{ id: fileId, user_id: userId, file_key: originalKey, book_hash: 'hash' }],
          error: null,
        });
      if (table === 'scholar_file_heads')
        return query('in', {
          data: [{ file_id: fileId, version_id: versionId }],
          error: null,
        });
      return query('in', {
        data: [{ file_id: fileId, version_id: versionId, object_key: versionKey }],
        error: null,
      });
    });
    const urls = await processFileKeys([originalKey], userId);
    expect(urls[originalKey]).toContain(versionKey);
    expect(getDownloadSignedUrl).toHaveBeenCalledWith(versionKey, 1800);
  });

  it('fails closed if a head points to a missing verified version', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'files')
        return query('is', {
          data: [{ id: fileId, user_id: userId, file_key: originalKey, book_hash: 'hash' }],
          error: null,
        });
      if (table === 'scholar_file_heads')
        return query('in', {
          data: [{ file_id: fileId, version_id: versionId }],
          error: null,
        });
      return query('in', { data: [], error: null });
    });
    const urls = await processFileKeys([originalKey], userId);
    expect(urls[originalKey]).toBeUndefined();
    expect(getDownloadSignedUrl).not.toHaveBeenCalled();
  });

  it('does not add version queries to bulk cover downloads', async () => {
    const coverKey = `${userId}/Readest/Books/hash/cover.png`;
    from.mockImplementation((table: string) => {
      if (table !== 'files') throw new Error('cover should not query Scholar versions');
      return query('is', {
        data: [{ id: fileId, user_id: userId, file_key: coverKey, book_hash: 'hash' }],
        error: null,
      });
    });
    const urls = await processFileKeys([coverKey], userId);
    expect(urls[coverKey]).toContain(coverKey);
  });

  it('does not sign an unuploaded zero-byte Scholar placeholder', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'files') return query('is', { data: [
        { id: fileId, user_id: userId, file_key: originalKey, book_hash: 'hash', file_size: 0 },
      ], error: null });
      return query('in', { data: [], error: null });
    });
    const urls = await processFileKeys([originalKey], userId);
    expect(urls[originalKey]).toBeUndefined();
    expect(getDownloadSignedUrl).not.toHaveBeenCalled();
  });

  it('preserves legacy downloads when the server has no Scholar schema yet', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'files') return query('is', {
        data: [{ id: fileId, user_id: userId, file_key: originalKey, book_hash: 'hash' }], error: null,
      });
      return query('in', { data: null, error: { code: 'PGRST205' } });
    });
    const urls = await processFileKeys([originalKey], userId);
    expect(urls[originalKey]).toContain(originalKey);
  });

  it('keeps a legacy object readable before that file has a version head', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'files')
        return query('is', {
          data: [{ id: fileId, user_id: userId, file_key: originalKey, book_hash: 'hash' }],
          error: null,
        });
      return query('in', { data: [], error: null });
    });
    const urls = await processFileKeys([originalKey], userId);
    expect(urls[originalKey]).toContain(originalKey);
  });
});
