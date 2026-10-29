import { DEFAULT_AI_SETTINGS } from './constants';
import type { AISettings } from './types';

export interface PdfTranslationModelRequest {
  provider: 'ai-gateway' | 'openrouter';
  model: string;
  apiKey: string;
  baseUrl?: string;
}

/**
 * pdf2zh executes on the self-hosted server, so it can use the two assistant
 * providers with an OpenAI-compatible server endpoint. Ollama stays local to
 * the device and is deliberately not sent to the server.
 */
export function getPdfTranslationModel(
  settings: AISettings | undefined,
): PdfTranslationModelRequest | null {
  const ai = settings ?? DEFAULT_AI_SETTINGS;
  if (!ai.enabled) return null;
  if (ai.provider === 'ai-gateway') {
    const model =
      ai.aiGatewayCustomModel || ai.aiGatewayModel || DEFAULT_AI_SETTINGS.aiGatewayModel;
    const apiKey = ai.aiGatewayApiKey;
    return model && apiKey ? { provider: 'ai-gateway', model, apiKey } : null;
  }
  if (ai.provider === 'openrouter') {
    const model = ai.openrouterModel || 'openai/gpt-4o-mini';
    const apiKey = ai.openrouterApiKey;
    const baseUrl = ai.openrouterBaseUrl || DEFAULT_AI_SETTINGS.openrouterBaseUrl;
    return model && apiKey && baseUrl ? { provider: 'openrouter', model, apiKey, baseUrl } : null;
  }
  return null;
}
