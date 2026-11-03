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
  baseUrlOverride?: string,
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
    const chatBaseUrl = ai.openrouterBaseUrl;
    // The translation worker runs server-side and the job API requires HTTPS,
    // while the chat endpoint is often a LAN HTTP URL. Prefer an explicit
    // setting, then a build-time translation endpoint, then an HTTPS chat URL.
    const baseUrl =
      baseUrlOverride?.trim() ||
      ai.pdfTranslationBaseUrl?.trim() ||
      process.env['NEXT_PUBLIC_PDF_TRANSLATION_BASE_URL'] ||
      (chatBaseUrl?.startsWith('https://') ? chatBaseUrl : '') ||
      chatBaseUrl ||
      DEFAULT_AI_SETTINGS.openrouterBaseUrl;
    return model && apiKey && baseUrl ? { provider: 'openrouter', model, apiKey, baseUrl } : null;
  }
  return null;
}
