import { createHash } from 'node:crypto';

export const AI_GATEWAY_OPENAI_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

export type TranslationModelProvider = 'ai-gateway' | 'openrouter';
export interface TranslationModelConfig {
  provider: TranslationModelProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
}

const hasControlCharacter = (value: string) => /[\u0000-\u001f\u007f]/.test(value);

function normalizeModel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const model = value.trim();
  return model.length >= 1 && model.length <= 120 && !hasControlCharacter(model) ? model : null;
}

function normalizeApiKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return key.length >= 1 && key.length <= 4096 && !hasControlCharacter(key) ? key : null;
}

function normalizeOpenAiBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || hasControlCharacter(value)) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * Converts the active assistant selection into a bounded OpenAI-compatible
 * profile. The API key is encrypted before it reaches durable job storage.
 */
export function normalizeTranslationModelConfig(value: unknown): TranslationModelConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const model = normalizeModel(input['model']);
  const apiKey = normalizeApiKey(input['apiKey']);
  if (!model || !apiKey) return null;
  if (input['provider'] === 'ai-gateway') {
    return { provider: 'ai-gateway', baseUrl: AI_GATEWAY_OPENAI_BASE_URL, model, apiKey };
  }
  if (input['provider'] === 'openrouter') {
    const baseUrl = normalizeOpenAiBaseUrl(input['baseUrl']);
    return baseUrl ? { provider: 'openrouter', baseUrl, model, apiKey } : null;
  }
  return null;
}

export function translationModelFingerprint(config: TranslationModelConfig): string {
  return createHash('sha256')
    .update(JSON.stringify([config.provider, config.baseUrl, config.model, config.apiKey]))
    .digest('hex');
}
