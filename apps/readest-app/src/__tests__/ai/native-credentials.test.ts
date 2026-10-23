import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadNativeAiCredentials,
  saveNativeAiCredential,
  withoutAiCredentials,
} from '@/services/ai/nativeCredentials';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import type { SystemSettings } from '@/types/settings';

const bridge = vi.hoisted(() => ({
  items: new Map<string, string>(),
  failWrite: false,
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/bridge', () => ({
  getSecureItem: vi.fn(async ({ key }: { key: string }) => ({ value: bridge.items.get(key) })),
  setSecureItem: vi.fn(async ({ key, value }: { key: string; value: string }) => {
    if (bridge.failWrite) return { success: false, error: 'locked' };
    bridge.items.set(key, value);
    return { success: true };
  }),
  clearSecureItem: vi.fn(async ({ key }: { key: string }) => {
    bridge.items.delete(key);
    return { success: true };
  }),
}));

beforeEach(() => {
  bridge.items.clear();
  bridge.failWrite = false;
});

describe('native AI credential storage', () => {
  it('stores credentials in separate account slots and removes a cleared key', async () => {
    await saveNativeAiCredential('alice', 'openrouterApiKey', 'secret-a');
    await saveNativeAiCredential('bob', 'openrouterApiKey', 'secret-b');
    expect(await loadNativeAiCredentials('alice')).toEqual({ openrouterApiKey: 'secret-a' });
    expect(await loadNativeAiCredentials('bob')).toEqual({ openrouterApiKey: 'secret-b' });
    await saveNativeAiCredential('alice', 'openrouterApiKey', '');
    expect(await loadNativeAiCredentials('alice')).toEqual({});
    expect(await loadNativeAiCredentials('bob')).toEqual({ openrouterApiKey: 'secret-b' });
  });

  it('fails loudly if the keychain rejects a new secret', async () => {
    bridge.failWrite = true;
    await expect(saveNativeAiCredential(null, 'aiGatewayApiKey', 'secret')).rejects.toThrow(
      /keychain/i,
    );
    expect(await loadNativeAiCredentials(null)).toEqual({});
  });

  it('removes secrets from a settings snapshot without changing live settings', () => {
    const settings = {
      ...DEFAULT_SYSTEM_SETTINGS,
      aiSettings: {
        ...DEFAULT_SYSTEM_SETTINGS.aiSettings,
        aiGatewayApiKey: 'gateway-secret',
        openrouterApiKey: 'router-secret',
      },
    } as SystemSettings;
    const clean = withoutAiCredentials(settings);
    expect(clean.aiSettings.aiGatewayApiKey).toBeUndefined();
    expect(clean.aiSettings.openrouterApiKey).toBeUndefined();
    expect(settings.aiSettings.aiGatewayApiKey).toBe('gateway-secret');
  });
});

describe('native settings persistence', () => {
  it('does not write API keys into settings.json or its backup', async () => {
    const { saveSettings } = await import('@/services/settingsService');
    const files = new Map<string, string>();
    const fs = {
      readFile: async (name: string) => {
        const content = files.get(name);
        if (!content) throw new Error('ENOENT');
        return content;
      },
      writeFile: async (name: string, _base: unknown, content: string) => {
        files.set(name, content);
      },
    } as unknown as import('@/types/system').FileSystem;
    const settings = {
      ...DEFAULT_SYSTEM_SETTINGS,
      aiSettings: {
        ...DEFAULT_SYSTEM_SETTINGS.aiSettings,
        aiGatewayApiKey: 'gateway-secret',
        openrouterApiKey: 'router-secret',
      },
    } as SystemSettings;
    await saveSettings(fs, settings);
    expect(files.get('settings.json')).not.toContain('gateway-secret');
    expect(files.get('settings.json.bak')).not.toContain('router-secret');
    expect(settings.aiSettings.aiGatewayApiKey).toBe('gateway-secret');
  });
});

describe('native settings hydration', () => {
  it('loads only the signed-in account key and scrubs a legacy plaintext key', async () => {
    const { loadSettings } = await import('@/services/settingsService');
    await saveNativeAiCredential('alice', 'openrouterApiKey', 'alice-key');
    await saveNativeAiCredential('bob', 'openrouterApiKey', 'bob-key');
    localStorage.setItem('user', JSON.stringify({ id: 'alice' }));
    const files = new Map<string, string>([
      [
        'settings.json',
        JSON.stringify({
          ...DEFAULT_SYSTEM_SETTINGS,
          aiSettings: {
            ...DEFAULT_SYSTEM_SETTINGS.aiSettings,
            aiGatewayApiKey: 'old-global-plaintext',
          },
        }),
      ],
    ]);
    const fs = {
      readFile: async (name: string) => {
        const content = files.get(name);
        if (!content) throw new Error('ENOENT');
        return content;
      },
      writeFile: async (name: string, _base: unknown, content: string) => {
        files.set(name, content);
      },
      getPrefix: async () => 'Books',
    } as unknown as import('@/types/system').FileSystem;
    const settings = await loadSettings({
      fs,
      isMobile: false,
      isEink: false,
      isAppDataSandbox: false,
    });
    expect(settings.aiSettings.openrouterApiKey).toBe('alice-key');
    expect(settings.aiSettings.aiGatewayApiKey).toBeUndefined();
    expect(files.get('settings.json')).not.toContain('old-global-plaintext');
    expect(files.get('settings.json.bak')).not.toContain('old-global-plaintext');
    expect(localStorage.getItem('scholar-ai-legacy-key-reentry:v1')).toBe('1');
    localStorage.clear();
  });
});

describe('native settings load race', () => {
  it('does not expose a key loaded for an account that signed out during startup', async () => {
    const { getSecureItem } = await import('@/utils/bridge');
    const { loadSettings } = await import('@/services/settingsService');
    let release!: (result: { value: string }) => void;
    vi.mocked(getSecureItem).mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; }),
    );
    localStorage.setItem('user', JSON.stringify({ id: 'alice' }));
    const files = new Map<string, string>([
      ['settings.json', JSON.stringify(DEFAULT_SYSTEM_SETTINGS)],
    ]);
    const fs = {
      readFile: async (name: string) => {
        const content = files.get(name);
        if (!content) throw new Error('ENOENT');
        return content;
      },
      writeFile: async (name: string, _base: unknown, content: string) => {
        files.set(name, content);
      },
      getPrefix: async () => 'Books',
    } as unknown as import('@/types/system').FileSystem;
    const loading = loadSettings({
      fs,
      isMobile: false,
      isEink: false,
      isAppDataSandbox: false,
    });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    localStorage.setItem('user', JSON.stringify({ id: 'bob' }));
    release({ value: 'alice-key' });
    const settings = await loading;
    expect(settings.aiSettings.aiGatewayApiKey).toBeUndefined();
    localStorage.clear();
  });
});
