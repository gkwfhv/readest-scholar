// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAppDeepLinkScheme,
  getPublicWebBaseUrl,
  isScholarReleaseBundle,
} from '@/services/environment';

afterEach(() => vi.unstubAllEnvs());

describe('server-side public web URL selection', () => {
  it('uses the runtime Scholar marker during the server render', () => {
    vi.stubEnv('SCHOLAR_RELEASE', 'true');
    expect(isScholarReleaseBundle()).toBe(true);
    expect(getAppDeepLinkScheme()).toBe('readest-scholar');
  });

  it('uses the explicit Scholar desktop target during static export', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    vi.stubEnv('NEXT_PUBLIC_SCHOLAR_RELEASE', 'true');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://scholar.example.test');
    vi.stubEnv('API_BASE_URL', 'https://web.readest.com');
    expect(getPublicWebBaseUrl()).toBe('https://scholar.example.test');
  });
});
