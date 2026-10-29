import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getRuntimeConfig, loadSelfHostedRuntimeConfig } from '@/services/runtimeConfig';
import { isCustomTTSAllowed } from '@/utils/access';

const STORAGE_KEY = 'readest.self-hosted-runtime-config.v1';

const SELF_HOSTED_CONFIG = {
  supabaseUrl: 'https://api.scholar.example.test',
  supabaseAnonKey: 'public-anon-key',
  apiBaseUrl: 'https://scholar.example.test',
  selfHostedWebUrl: 'https://scholar.example.test',
  selfHosted: true,
};

describe('saved self-hosted runtime configuration', () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.__READEST_RUNTIME_CONFIG;
    vi.stubEnv('SELF_HOSTED', '');
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '');
  });

  afterEach(() => {
    localStorage.clear();
    delete window.__READEST_RUNTIME_CONFIG;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses the server saved by a desktop user before packaged defaults', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SELF_HOSTED_CONFIG));

    expect(getRuntimeConfig()).toMatchObject(SELF_HOSTED_CONFIG);
  });

  it('loads a server configuration from its root runtime endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...SELF_HOSTED_CONFIG,
        authProviders: ['google', 'azure', 'github'],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      loadSelfHostedRuntimeConfig('https://scholar.example.test'),
    ).resolves.toMatchObject({
      ...SELF_HOSTED_CONFIG,
      authProviders: ['google', 'github'],
      selfHostedWebUrl: 'https://scholar.example.test',
    });
    expect(fetchMock).toHaveBeenCalledWith('https://scholar.example.test/runtime-config.json', {
      headers: { Accept: 'application/json' },
    });
  });

  it('unlocks custom TTS for a saved self-hosted server without a paid plan', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SELF_HOSTED_CONFIG));

    expect(isCustomTTSAllowed(null)).toBe(true);
  });
});
