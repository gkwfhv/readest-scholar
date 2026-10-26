import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';

vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      refreshSession: vi.fn().mockResolvedValue(undefined),
      signOut: vi.fn().mockResolvedValue(undefined),
    },
  },
}));
vi.mock('posthog-js', () => ({ default: { identify: vi.fn() } }));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => true,
}));
vi.mock('@/services/ai/nativeCredentials', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/ai/nativeCredentials')>();
  return {
    ...original,
    loadNativeAiCredentials: vi.fn(async (userId: string | null) =>
      userId ? { openrouterApiKey: `key-for-${userId}` } : {},
    ),
  };
});

import { AuthProvider, useAuth } from '@/context/AuthContext';
import { loadNativeAiCredentials } from '@/services/ai/nativeCredentials';

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SYSTEM_SETTINGS,
      aiSettings: {
        ...DEFAULT_AI_SETTINGS,
        openrouterApiKey: 'key-for-alice',
      },
    } as SystemSettings,
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('native AI credential account switch', () => {
  it('ignores a delayed keychain read from the previous account', async () => {
    let resolveAlice!: (value: { openrouterApiKey: string }) => void;
    vi.mocked(loadNativeAiCredentials).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAlice = resolve;
        }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() => {
      result.current.login('alice-token', {
        id: 'alice',
      } as Parameters<typeof result.current.login>[1]);
      result.current.login('bob-token', {
        id: 'bob',
      } as Parameters<typeof result.current.login>[1]);
    });
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.aiSettings.openrouterApiKey).toBe('key-for-bob'),
    );
    await act(async () => resolveAlice({ openrouterApiKey: 'late-alice-key' }));
    expect(useSettingsStore.getState().settings.aiSettings.openrouterApiKey).toBe('key-for-bob');
  });

  it('clears the old key before exposing the new account and hydrates only its slot', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() => {
      result.current.login('bob-token', { id: 'bob' } as Parameters<
        typeof result.current.login
      >[1]);
    });
    expect(useSettingsStore.getState().settings.aiSettings.openrouterApiKey).toBeUndefined();
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.aiSettings.openrouterApiKey).toBe('key-for-bob'),
    );
    act(() => {
      result.current.login('alice-token', {
        id: 'alice',
      } as Parameters<typeof result.current.login>[1]);
    });
    expect(useSettingsStore.getState().settings.aiSettings.openrouterApiKey).toBeUndefined();
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.aiSettings.openrouterApiKey).toBe(
        'key-for-alice',
      ),
    );
  });
});
