import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';

const mocks = vi.hoisted(() => ({
  fetchModels: vi.fn(async () => [{ id: 'embedding-first' }, { id: 'chat-second' }]),
  saveSettings: vi.fn(async () => {}),
  setSettings: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: {} }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      aiSettings: {
        ...DEFAULT_AI_SETTINGS,
        enabled: true,
        provider: 'openrouter',
        openrouterApiKey: 'synthetic-key',
        openrouterBaseUrl: 'https://example.test/v1',
        openrouterModel: 'private-chat-model',
        openrouterEmbeddingModel: 'private-embedding-model',
      },
    },
    saveSettings: mocks.saveSettings,
    setSettings: mocks.setSettings,
  }),
}));
vi.mock('@/services/ai/providers/OpenRouterProvider', () => ({
  fetchOpenRouterModels: mocks.fetchModels,
}));
vi.mock('@/services/ai/providers', () => ({ getAIProvider: vi.fn() }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));

import AIPanel from '@/components/settings/AIPanel';

describe('OpenAI-compatible model settings', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchModels.mockResolvedValue([{ id: 'embedding-first' }, { id: 'chat-second' }]);
  });

  it('keeps custom chat and embedding IDs after model discovery', async () => {
    render(<AIPanel />);
    await waitFor(() => expect(mocks.fetchModels).toHaveBeenCalled());
    await screen.findByDisplayValue('private-chat-model');
    expect(screen.getByDisplayValue('private-embedding-model')).toBeTruthy();
    expect(mocks.setSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({
        aiSettings: expect.objectContaining({ openrouterModel: 'embedding-first' }),
      }),
    );
  });

  it('ignores a stale model list after the endpoint changes', async () => {
    let resolveOld!: (models: { id: string }[]) => void;
    mocks.fetchModels.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    mocks.fetchModels.mockResolvedValueOnce([{ id: 'new-endpoint-model' }]);

    render(<AIPanel />);
    await waitFor(() => expect(mocks.fetchModels).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByDisplayValue('https://example.test/v1'), {
      target: { value: 'https://new.example.test/v1' },
    });
    await waitFor(() => expect(mocks.fetchModels).toHaveBeenCalledTimes(2));
    await act(async () => resolveOld([{ id: 'old-endpoint-model' }]));
    await waitFor(() => {
      const values = Array.from(
        document.querySelectorAll<HTMLOptionElement>('#openrouter-chat-model-options option'),
      ).map((option) => option.value);
      expect(values).toEqual(['new-endpoint-model']);
    });
    expect(screen.getByDisplayValue('private-chat-model')).toBeTruthy();
  });
});
