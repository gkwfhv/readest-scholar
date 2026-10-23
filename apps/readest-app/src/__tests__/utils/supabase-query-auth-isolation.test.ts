import { afterEach, describe, expect, test, vi } from 'vitest';

describe('query Supabase client auth isolation', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  test('does not load the interactive account session into a query client', async () => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://auth.example.test');
    vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon-key');

    const user = { id: 'reader-1', aud: 'authenticated', role: 'authenticated' };
    const session = {
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    };
    localStorage.setItem('sb-auth-auth-token', JSON.stringify(session));

    const { createSupabaseClient } = await import('@/utils/supabase');
    const queryClient = createSupabaseClient('explicit-access-token');
    expect((await queryClient.auth.getSession()).data.session).toBeNull();
    expect(JSON.parse(localStorage.getItem('sb-auth-auth-token') ?? '{}')).toEqual(session);
  });
});
