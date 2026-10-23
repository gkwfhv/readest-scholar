import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import type { FileSystem } from '@/types/system';
import type { SystemSettings } from '@/types/settings';

vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/utils/supabase', () => ({ supabase: {} }));
vi.mock('@/services/ai/webCredentials', () => ({
  loadWebAiCredentials: vi.fn(async () => ({ openrouterApiKey: 'vault-key' })),
}));
import { loadWebAiCredentials } from '@/services/ai/webCredentials';
import { loadSettings, saveSettings } from '@/services/settingsService';

function fileSystem(files: Map<string, string>): FileSystem {
  return {
    readFile: async (name: string) => {
      const content = files.get(name);
      if (!content) throw new Error('ENOENT');
      return content;
    },
    writeFile: async (name: string, _base: unknown, content: string) => {
      files.set(name, content);
    },
    getPrefix: async () => 'Books',
  } as unknown as FileSystem;
}
const context = (fs: FileSystem) => ({
  fs,
  isMobile: false,
  isEink: false,
  isAppDataSandbox: false,
});
beforeEach(() => {
  localStorage.clear();
  vi.mocked(loadWebAiCredentials).mockReset().mockResolvedValue({ openrouterApiKey: 'vault-key' });
});
afterEach(() => localStorage.clear());

describe('Web AI credential persistence', () => {
  it('never writes API keys to IndexedDB settings or its backup', async () => {
    const files = new Map<string, string>();
    const settings = {
      ...DEFAULT_SYSTEM_SETTINGS,
      aiSettings: {
        ...DEFAULT_SYSTEM_SETTINGS.aiSettings,
        aiGatewayApiKey: 'plaintext-key',
      },
    } as SystemSettings;
    await saveSettings(fileSystem(files), settings);
    expect(files.get('settings.json')).not.toContain('plaintext-key');
    expect(files.get('settings.json.bak')).not.toContain('plaintext-key');
  });
  it('scrubs an unowned legacy key and hydrates only the signed-in vault', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 'alice' }));
    localStorage.setItem('token', 'alice-token');
    const files = new Map([
      [
        'settings.json',
        JSON.stringify({
          ...DEFAULT_SYSTEM_SETTINGS,
          aiSettings: {
            ...DEFAULT_SYSTEM_SETTINGS.aiSettings,
            aiGatewayApiKey: 'old-plaintext',
          },
        }),
      ],
    ]);
    const settings = await loadSettings(context(fileSystem(files)));
    expect(settings.aiSettings.aiGatewayApiKey).toBeUndefined();
    expect(settings.aiSettings.openrouterApiKey).toBe('vault-key');
    expect(settings.aiSettings.credentialScope).toBe('user:alice');
    expect(files.get('settings.json')).not.toContain('old-plaintext');
    expect(files.get('settings.json.bak')).not.toContain('old-plaintext');
    expect(loadWebAiCredentials).toHaveBeenCalledWith('alice-token');
  });
  it('ignores a vault response from an account that switched during startup', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 'alice' }));
    localStorage.setItem('token', 'alice-token');
    let release!: (value: { openrouterApiKey: string }) => void;
    vi.mocked(loadWebAiCredentials).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const files = new Map([['settings.json', JSON.stringify(DEFAULT_SYSTEM_SETTINGS)]]);
    const loading = loadSettings(context(fileSystem(files)));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    localStorage.setItem('user', JSON.stringify({ id: 'bob' }));
    release({ openrouterApiKey: 'alice-key' });
    const settings = await loading;
    expect(settings.aiSettings.openrouterApiKey).toBeUndefined();
  });
});
