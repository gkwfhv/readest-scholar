import { createGateway, streamText } from 'ai';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, AISettings, AIProviderName } from '../types';
import { aiLogger } from '../logger';
import { GATEWAY_MODELS } from '../constants';
import { AI_TIMEOUTS } from '../utils/retry';
import { getAIFetch } from '../utils/httpFetch';
import { isTauriAppPlatform } from '@/services/environment';
import { createProxiedEmbeddingModel } from './ProxiedGatewayEmbedding';

export class AIGatewayProvider implements AIProvider {
  id: AIProviderName = 'ai-gateway';
  name = 'AI Gateway (Cloud)';
  requiresAuth = true;

  private settings: AISettings;
  private gateway: ReturnType<typeof createGateway>;

  constructor(settings: AISettings) {
    this.settings = settings;
    if (!settings.aiGatewayApiKey) {
      throw new Error('AI Gateway API key required');
    }
    // On Tauri the request leaves from the Rust HTTP transport (no CORS, no
    // cleartext restrictions); on web builds this is window.fetch.
    this.gateway = createGateway({ apiKey: settings.aiGatewayApiKey, fetch: getAIFetch() });
    aiLogger.provider.init(
      'ai-gateway',
      settings.aiGatewayModel || GATEWAY_MODELS.GEMINI_FLASH_LITE,
    );
  }

  getModel(): LanguageModel {
    const modelId = this.settings.aiGatewayModel || GATEWAY_MODELS.GEMINI_FLASH_LITE;
    return this.gateway(modelId);
  }

  getEmbeddingModel(): EmbeddingModel {
    const embedModel = this.settings.aiGatewayEmbeddingModel || 'openai/text-embedding-3-small';

    // The /api/ai/embed proxy route only exists on web builds; on Tauri call
    // the gateway directly through the Rust HTTP transport.
    if (!isTauriAppPlatform()) {
      return createProxiedEmbeddingModel({
        apiKey: this.settings.aiGatewayApiKey!,
        model: embedModel,
      });
    }

    return this.gateway.embeddingModel(embedModel);
  }

  async isAvailable(): Promise<boolean> {
    return !!this.settings.aiGatewayApiKey;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.settings.aiGatewayApiKey) return false;

    const modelId = this.settings.aiGatewayModel || GATEWAY_MODELS.GEMINI_FLASH_LITE;

    // On Tauri the /api/ai/chat proxy route does not exist (asset protocol
    // serves static files only), so probe the gateway directly.
    if (isTauriAppPlatform()) {
      try {
        aiLogger.provider.init('ai-gateway', `healthCheck starting with model: ${modelId}`);
        const result = streamText({
          model: this.gateway(modelId),
          messages: [{ role: 'user', content: 'hi' }],
          abortSignal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
        });
        await result.text;
        aiLogger.provider.init('ai-gateway', 'healthCheck success');
        return true;
      } catch (e) {
        const error = e as Error;
        aiLogger.provider.error('ai-gateway', `healthCheck failed: ${error.message}`);
        return false;
      }
    }

    try {
      aiLogger.provider.init('ai-gateway', `healthCheck starting with model: ${modelId}`);

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'hi' }],
          apiKey: this.settings.aiGatewayApiKey,
          model: modelId,
        }),
        signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `Health check failed: ${response.status}`);
      }

      aiLogger.provider.init('ai-gateway', 'healthCheck success');
      return true;
    } catch (e) {
      const error = e as Error;
      aiLogger.provider.error('ai-gateway', `healthCheck failed: ${error.message}`);
      return false;
    }
  }
}
