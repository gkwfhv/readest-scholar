import { describe, expect, it } from 'vitest';
import {
  AI_GATEWAY_OPENAI_BASE_URL,
  normalizeTranslationModelConfig,
  translationModelFingerprint,
} from '@/server/scholarTranslationModel';

describe('Scholar translation model profile', () => {
  it('maps the selected AI Gateway model to its OpenAI-compatible endpoint', () => {
    expect(
      normalizeTranslationModelConfig({
        provider: 'ai-gateway',
        model: 'openai/gpt-5-nano',
        apiKey: 'synthetic-key',
      }),
    ).toEqual({
      provider: 'ai-gateway',
      baseUrl: AI_GATEWAY_OPENAI_BASE_URL,
      model: 'openai/gpt-5-nano',
      apiKey: 'synthetic-key',
    });
  });

  it('allows only a clean HTTPS custom endpoint and fingerprints secrets without storing them', () => {
    const config = normalizeTranslationModelConfig({
      provider: 'openrouter',
      baseUrl: 'https://models.example.test/v1/',
      model: 'provider/model',
      apiKey: 'synthetic-key',
    });
    expect(config).toEqual({
      provider: 'openrouter',
      baseUrl: 'https://models.example.test/v1',
      model: 'provider/model',
      apiKey: 'synthetic-key',
    });
    expect(translationModelFingerprint(config!)).toMatch(/^[0-9a-f]{64}$/);
    expect(translationModelFingerprint(config!)).not.toContain('synthetic-key');
    for (const baseUrl of ['http://127.0.0.1:11434', 'https://name:pass@example.test/v1']) {
      expect(
        normalizeTranslationModelConfig({
          provider: 'openrouter',
          baseUrl,
          model: 'provider/model',
          apiKey: 'synthetic-key',
        }),
      ).toBeNull();
    }
  });
});
