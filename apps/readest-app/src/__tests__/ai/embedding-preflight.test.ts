import { beforeEach, describe, expect, it, vi } from 'vitest';

const { embedMock } = vi.hoisted(() => ({ embedMock: vi.fn() }));
vi.mock('ai', () => ({ embed: embedMock }));

import { verifyEmbeddingModel } from '@/services/ai/embeddingPreflight';
import type { AIProvider } from '@/services/ai/types';

const provider = {
  getEmbeddingModel: vi.fn(() => ({ modelId: 'embedding-test' })),
} as unknown as AIProvider;

describe('verifyEmbeddingModel', () => {
  beforeEach(() => {
    embedMock.mockReset();
  });

  it('accepts a non-empty embedding vector', async () => {
    embedMock.mockResolvedValue({ embedding: [0.1, 0.2] });

    await expect(verifyEmbeddingModel(provider)).resolves.toBeUndefined();
    expect(embedMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: expect.anything(), value: expect.any(String) }),
    );
  });

  it('turns an embedding endpoint failure into an actionable indexing error', async () => {
    embedMock.mockRejectedValue(new Error('model does not support embeddings'));

    await expect(verifyEmbeddingModel(provider)).rejects.toThrow(
      'Configure an embedding-capable model',
    );
  });
});
