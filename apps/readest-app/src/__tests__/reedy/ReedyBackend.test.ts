import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { AISettings } from '@/services/ai/types';
import type { AppService } from '@/types/system';
import { ReedyBackend } from '@/services/ai/adapters/ReedyBackend';

const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  indexBook: vi.fn(),
}));

vi.mock('ai', () => ({ embed: mocks.embed, embedMany: vi.fn() }));
vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({ getEmbeddingModel: () => ({ modelId: 'test-embed' }) }),
}));
vi.mock('@/services/reedy/db/ReedyDb', () => ({
  ReedyDb: class {
    getBookMeta = async () => ({ chunkCount: 1 });
  },
}));
vi.mock('@/services/reedy/retrieval/BookIndexer', () => ({
  BookIndexer: class {
    indexBook = mocks.indexBook;
  },
}));
vi.mock('@/services/reedy/retrieval/BookRetriever', () => ({
  BookRetriever: class {},
}));
vi.mock('@/services/reedy/instrumentation', () => ({
  NoopReedyMetrics: class {
    log = vi.fn();
  },
  ReedyMetrics: class {
    log = vi.fn();
  },
}));

beforeEach(() => {
  mocks.embed.mockReset().mockResolvedValue({ embedding: Array(1536).fill(0) });
  mocks.indexBook.mockReset().mockImplementation(async (_doc, _hash, model) => {
    expect(model.dim).toBe(1536);
  });
});

describe('ReedyBackend', () => {
  it('learns the embedding dimension before starting the first book index', async () => {
    const appService = { openDatabase: vi.fn().mockResolvedValue({}) } as unknown as AppService;
    const settings = {
      provider: 'openai-compatible',
      openaiCompatible: { embeddingModel: 'test-embed' },
    } as unknown as AISettings;
    const backend = new ReedyBackend(appService, settings);

    await backend.indexBook({} as BookDoc, 'synthetic-book');

    expect(mocks.embed).toHaveBeenCalledOnce();
    expect(mocks.indexBook).toHaveBeenCalledOnce();
  });
});
