import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';

vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      refreshSession: vi.fn().mockResolvedValue(undefined),
      signOut: vi.fn().mockResolvedValue(undefined),
    },
  },
}));
vi.mock('posthog-js', () => ({ default: { identify: vi.fn() } }));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => false,
}));
vi.mock('@/services/ai/webCredentials', () => ({
  loadWebAiCredentials: vi.fn(async (token: string) => ({ openrouterApiKey: `key-for-${token}` })),
}));

import { AuthProvider, useAuth } from '@/context/AuthContext';
import { loadWebAiCredentials } from '@/services/ai/webCredentials';

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SYSTEM_SETTINGS,
      aiSettings: {
        ...DEFAULT_AI_SETTINGS,
        credentialScope: 'user:alice',
        openrouterApiKey: 'old-key',
      },
    } as SystemSettings,
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Web vault account switch', () => {
  it('retries vault hydration after a same-account token refresh without clearing the live key', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() =>
      result.current.login('alice-token', { id: 'alice' } as Parameters<
        typeof result.current.login
      >[1]),
    );
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.aiSettings.openrouterApiKey).toBe(
        'key-for-alice-token',
      ),
    );
    act(() =>
      result.current.login('alice-token-2', { id: 'alice' } as Parameters<
        typeof result.current.login
      >[1]),
    );
    expect(useSettingsStore.getState().settings.aiSettings.openrouterApiKey).toBe(
      'key-for-alice-token',
    );
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.aiSettings.openrouterApiKey).toBe(
        'key-for-alice-token-2',
      ),
    );
  });

  it('clears an old key immediately and ignores a delayed old account response', async () => {
    let resolveAlice!: (value: { openrouterApiKey: string }) => void;
    vi.mocked(loadWebAiCredentials).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAlice = resolve;
        }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() =>
      result.current.login('alice-token', { id: 'alice' } as Parameters<
        typeof result.current.login
      >[1]),
    );
    expect(useSettingsStore.getState().settings.aiSettings.openrouterApiKey).toBeUndefined();
    act(() =>
      result.current.login('bob-token', { id: 'bob' } as Parameters<
        typeof result.current.login
      >[1]),
    );
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.aiSettings.openrouterApiKey).toBe(
        'key-for-bob-token',
      ),
    );
    await act(async () => resolveAlice({ openrouterApiKey: 'late-alice-key' }));
    expect(useSettingsStore.getState().settings.aiSettings.openrouterApiKey).toBe(
      'key-for-bob-token',
    );
  });
});
