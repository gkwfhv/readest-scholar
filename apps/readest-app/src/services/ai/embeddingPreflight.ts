import { embed } from 'ai';
import type { AIProvider } from './types';

const PROBE_TEXT = 'Readest Scholar embedding connection check.';

/**
 * Verify the separate embeddings capability used to build a book index.
 * A provider can serve chat completions successfully while rejecting embeddings,
 * so the regular connection test alone cannot establish that indexing will work.
 */
export async function verifyEmbeddingModel(provider: AIProvider): Promise<void> {
  try {
    const result = await embed({
      model: provider.getEmbeddingModel(),
      value: PROBE_TEXT,
    });
    if (!Array.isArray(result.embedding) || result.embedding.length === 0) {
      throw new Error('The embedding service returned an empty vector.');
    }
  } catch (cause) {
    const detail = cause instanceof Error && cause.message ? ` ${cause.message}` : '';
    throw new Error(
      `Embedding model is unavailable. Configure an embedding-capable model in Settings > AI Assistant before indexing a book.${detail}`,
    );
  }
}
