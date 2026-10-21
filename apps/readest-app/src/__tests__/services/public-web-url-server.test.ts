// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPublicWebBaseUrl } from '@/services/environment';

afterEach(() => vi.unstubAllEnvs());

describe('server-side public web URL selection', () => {
  it('uses the explicit Scholar desktop target during static export', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    vi.stubEnv('NEXT_PUBLIC_SCHOLAR_RELEASE', 'true');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://scholar.example.test');
    vi.stubEnv('API_BASE_URL', 'https://web.readest.com');
    expect(getPublicWebBaseUrl()).toBe('https://scholar.example.test');
  });
});
