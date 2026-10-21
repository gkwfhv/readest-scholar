// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const query = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
};

vi.mock('@/utils/access', () => ({
  validateUserAndToken: vi
    .fn()
    .mockResolvedValue({ user: { id: 'synthetic-user' }, token: 'synthetic' }),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({ from: () => query }),
}));

import { GET } from '@/app/api/share/list/route';

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/share/list', () => {
  it('returns the configured self-hosted share origin, not the upstream one', async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('SITE_URL', 'https://scholar.example.test');
    const response = await GET(new Request('https://scholar.example.test/api/share/list'));
    expect(response.status).toBe(200);
    expect((await response.json()).shareUrlBase).toBe('https://scholar.example.test/s');
  });
});
