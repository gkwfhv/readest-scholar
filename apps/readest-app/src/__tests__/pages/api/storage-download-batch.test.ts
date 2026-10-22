import { describe, expect, it, vi } from 'vitest';
import { processFileKeys } from '@/pages/api/storage/download';

const queryBatches = vi.hoisted(() => [] as string[][]);

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: () => {
      let batch: string[] = [];
      const query = {
        select: () => query,
        eq: () => query,
        in: (_column: string, ids: string[]) => {
          batch = ids;
          queryBatches.push(ids);
          return query;
        },
        is: async () => ({
          data: batch.map((fileKey) => ({
            user_id: 'synthetic-user',
            file_key: fileKey,
            book_hash: null,
          })),
          error: null,
        }),
      };
      return query;
    },
  }),
}));

vi.mock('@/utils/object', () => ({
  getDownloadSignedUrl: async (fileKey: string) => `https://example.test/${fileKey}`,
}));

describe('storage download authorization queries', () => {
  it('authorizes 201 cover keys without sending an oversized PostgREST URL', async () => {
    queryBatches.length = 0;
    const keys = Array.from(
      { length: 201 },
      (_, index) => `synthetic-user/Readest/Books/${String(index).padStart(32, '0')}/cover.png`,
    );
    const urls = await processFileKeys(keys, 'synthetic-user');

    expect(queryBatches.length).toBeGreaterThan(1);
    expect(queryBatches.every((batch) => batch.length <= 50)).toBe(true);
    expect(Object.keys(urls)).toHaveLength(keys.length);
    expect(urls[keys[200]!]).toContain(keys[200]!);
  });
});
