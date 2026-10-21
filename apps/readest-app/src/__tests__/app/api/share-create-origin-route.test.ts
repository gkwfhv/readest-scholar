// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const countQuery = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  gt: vi.fn().mockResolvedValue({ count: 0, error: null }),
};
const filesQuery = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockResolvedValue({
    data: [{ file_key: 'synthetic/sample-paper.pdf', file_size: 42 }],
    error: null,
  }),
};
const table = {
  select: (...args: unknown[]) => countQuery.select(...args),
  insert: vi.fn().mockResolvedValue({ error: null }),
};

vi.mock('@/utils/access', () => ({
  validateUserAndToken: vi
    .fn()
    .mockResolvedValue({ user: { id: 'synthetic-user' }, token: 'synthetic' }),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (name: string) => (name === 'files' ? filesQuery : table),
  }),
}));
vi.mock('@/utils/object', () => ({ objectExists: vi.fn().mockResolvedValue(true) }));
vi.mock('@/libs/shareServer', () => ({
  generateShareToken: vi.fn().mockResolvedValue({ raw: 'SyntheticShareToken123', hash: 'hash' }),
}));

import { POST } from '@/app/api/share/create/route';

afterEach(() => vi.unstubAllEnvs());

describe('POST /api/share/create', () => {
  it('returns a link to the configured self-hosted site', async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('SITE_URL', 'https://scholar.example.test');
    const response = await POST(
      new Request('https://scholar.example.test/api/share/create', {
        method: 'POST',
        headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' },
        body: JSON.stringify({
          bookHash: 'sample-hash',
          expirationDays: 1,
          title: 'Synthetic paper',
          format: 'pdf',
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).url).toBe(
      'https://scholar.example.test/s/SyntheticShareToken123',
    );
  });
});
