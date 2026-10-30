import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelSwitcher } from '@/components/assistant/ModelSwitcher';

const mocks = vi.hoisted(() => ({
  setSettings: vi.fn(),
  saveSettings: vi.fn(async () => {}),
  fetchOpenRouterModels: vi.fn(
    async (_baseUrl?: string, _apiKey?: string) => [] as { id: string }[],
  ),
  store: null as unknown,
  isRunning: false,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@assistant-ui/react', () => ({
  useAssistantState: (select: (s: unknown) => unknown) =>
    select({ thread: { isRunning: mocks.isRunning } }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector?: (s: unknown) => unknown) =>
    selector ? selector(mocks.store) : mocks.store,
}));

vi.mock('@/services/ai/providers/OpenRouterProvider', () => ({
  fetchOpenRouterModels: (baseUrl: string, apiKey: string) =>
    mocks.fetchOpenRouterModels(baseUrl, apiKey),
}));

const baseAiSettings = {
  provider: 'ollama' as const,
  ollamaBaseUrl: 'http://o:11434',
  ollamaModel: 'llama3.2',
  ollamaEmbeddingModel: 'nomic-embed-text',
  aiGatewayModel: undefined,
  aiGatewayCustomModel: undefined,
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  openrouterModel: '',
  openrouterApiKey: 'sk-x',
};

const setStore = (aiSettings: Record<string, unknown>) => {
  mocks.store = {
    settings: { aiSettings },
    setSettings: mocks.setSettings,
    saveSettings: mocks.saveSettings,
  };
};

const openMenu = () => {
  fireEvent.pointerDown(screen.getByLabelText('Select AI model'), { button: 0, ctrlKey: false });
};

describe('ModelSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isRunning = false;
    setStore({ ...baseAiSettings });
  });

  afterEach(cleanup);

  it('lists Ollama models and writes the selection to global settings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3.2' }, { name: 'qwen2.5' }] }),
      })),
    );
    render(<ModelSwitcher />);

    openMenu();
    fireEvent.click(await screen.findByText('qwen2.5'));

    await waitFor(() => expect(mocks.setSettings).toHaveBeenCalledTimes(1));
    expect(mocks.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        aiSettings: expect.objectContaining({ ollamaModel: 'qwen2.5' }),
      }),
    );
    expect(mocks.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('lists the static gateway models without any fetch', async () => {
    setStore({
      ...baseAiSettings,
      provider: 'ai-gateway',
      aiGatewayModel: 'google/gemini-2.5-flash-lite',
    });
    render(<ModelSwitcher />);

    openMenu();
    expect(await screen.findByText('meta/llama-4-scout')).toBeTruthy();
    fireEvent.click(screen.getByText('xai/grok-4.1-fast-reasoning'));

    await waitFor(() => expect(mocks.setSettings).toHaveBeenCalledTimes(1));
    expect(mocks.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        aiSettings: expect.objectContaining({ aiGatewayModel: 'xai/grok-4.1-fast-reasoning' }),
      }),
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('lists OpenAI-compatible models from the configured endpoint', async () => {
    setStore({ ...baseAiSettings, provider: 'openrouter', openrouterModel: 'deepseek-r1' });
    mocks.fetchOpenRouterModels.mockResolvedValue([{ id: 'deepseek-r1' }, { id: 'gpt-oss-120b' }]);
    render(<ModelSwitcher />);

    openMenu();
    fireEvent.click(await screen.findByText('gpt-oss-120b'));

    await waitFor(() => expect(mocks.setSettings).toHaveBeenCalledTimes(1));
    expect(mocks.fetchOpenRouterModels).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1',
      'sk-x',
    );
    expect(mocks.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        aiSettings: expect.objectContaining({ openrouterModel: 'gpt-oss-120b' }),
      }),
    );
  });

  it('shows an empty state when the model list cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    render(<ModelSwitcher />);

    openMenu();
    expect(await screen.findByText('No models found')).toBeTruthy();
  });

  it('disables the trigger while the assistant is running', () => {
    mocks.isRunning = true;
    render(<ModelSwitcher />);

    const trigger = screen.getByLabelText('Select AI model') as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
  });
});
