import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import type { SystemSettings } from '@/types/settings';

vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => true,
}));

import { useSettingsStore } from '@/store/settingsStore';

beforeEach(() => localStorage.clear());

describe('native settings account gate', () => {
  it('rejects a delayed settings snapshot carrying a different account key', () => {
    localStorage.setItem('user', JSON.stringify({ id: 'bob' }));
    useSettingsStore.getState().setSettings({
      ...DEFAULT_SYSTEM_SETTINGS,
      aiSettings: {
        ...DEFAULT_AI_SETTINGS,
        credentialScope: 'user:alice',
        openrouterApiKey: 'alice-secret',
      },
    } as SystemSettings);
    expect(useSettingsStore.getState().settings.aiSettings.openrouterApiKey).toBeUndefined();
  });

  it('keeps the active account key in memory', () => {
    localStorage.setItem('user', JSON.stringify({ id: 'bob' }));
    useSettingsStore.getState().setSettings({
      ...DEFAULT_SYSTEM_SETTINGS,
      aiSettings: {
        ...DEFAULT_AI_SETTINGS,
        credentialScope: 'user:bob',
        openrouterApiKey: 'bob-secret',
      },
    } as SystemSettings);
    expect(useSettingsStore.getState().settings.aiSettings.openrouterApiKey).toBe('bob-secret');
  });
});
