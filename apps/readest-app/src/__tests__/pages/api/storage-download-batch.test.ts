import { describe, expect, it, vi } from 'vitest';
import { processFileKeys } from '@/pages/api/storage/download';

const queryBatches = vi.hoisted(() => [] as string[][]);
const queryColumns = vi.hoisted(() => [] as string[]);
const fallbackMode = vi.hoisted(() => ({ enabled: false }));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: () => {
      let batch: string[] = [];
      let column = 'file_key';
      const query = {
        select: () => query,
        eq: () => query,
        in: (nextColumn: string, ids: string[]) => {
          batch = ids;
          column = nextColumn;
          queryBatches.push(ids);
          queryColumns.push(nextColumn);
          return query;
        },
        is: async () => ({
          data:
            fallbackMode.enabled && column === 'file_key'
              ? []
              : batch.map((id) => ({
                  user_id: 'synthetic-user',
                  file_key:
                    column === 'book_hash' ? `synthetic-user/Readest/Books/${id}/cover.png` : id,
                  book_hash: column === 'book_hash' ? id : null,
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
    queryColumns.length = 0;
    fallbackMode.enabled = false;
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

  it('chunks the legacy book-hash fallback when 201 keys are missing', async () => {
    queryBatches.length = 0;
    queryColumns.length = 0;
    fallbackMode.enabled = true;
    const keys = Array.from(
      { length: 201 },
      (_, index) => `synthetic-user/Readest/Books/${String(index).padStart(32, '0')}/cover.png`,
    );
    const urls = await processFileKeys(keys, 'synthetic-user');

    expect(queryColumns.filter((column) => column === 'book_hash').length).toBeGreaterThan(1);
    expect(queryBatches.every((batch) => batch.length <= 50)).toBe(true);
    expect(urls[keys[200]!]).toContain(keys[200]!);
    fallbackMode.enabled = false;
  });
});
