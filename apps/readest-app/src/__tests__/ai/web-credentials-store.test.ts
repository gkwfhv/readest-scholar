import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import type { SystemSettings } from '@/types/settings';

vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/utils/supabase', () => ({ supabase: {} }));
import { useSettingsStore } from '@/store/settingsStore';

beforeEach(() => localStorage.clear());

describe('Web settings account gate', () => {
  it('removes a delayed previous-account key from the incoming snapshot', () => {
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
  it('keeps a current-account vault key in memory', () => {
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
