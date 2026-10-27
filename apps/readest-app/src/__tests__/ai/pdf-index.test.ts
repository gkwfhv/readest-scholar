import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AISettings, BookIndexMeta, TextChunk } from '@/services/ai/types';

const embedManyMock = vi.hoisted(() => vi.fn());
const embedMock = vi.hoisted(() => vi.fn());

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  embedMany: embedManyMock,
  embed: embedMock,
}));
vi.mock('@/services/ai/utils/retry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/utils/retry')>()),
  withRetryAndTimeout: (work: () => Promise<unknown>) => work(),
}));

const store = vi.hoisted(() => ({
  getMeta: vi.fn(),
  clearBook: vi.fn(async () => {}),
  saveChunks: vi.fn(async (_chunks: TextChunk[], _assertCurrent?: () => void) => {}),
  saveBM25Index: vi.fn(async () => {}),
  saveMeta: vi.fn(async () => {}),
  hybridSearch: vi.fn(async () => []),
}));

vi.mock('@/services/ai/storage/aiStore', () => ({ aiStore: store }));
vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({ getEmbeddingModel: () => ({}) }),
}));

import { hybridSearch, indexBook, isBookIndexed } from '@/services/ai/ragService';

const settings = { provider: 'ollama' } as AISettings;
const oldMeta: BookIndexMeta = {
  bookHash: 'pdf',
  bookTitle: 'Paper',
  authorName: 'Researcher',
  totalSections: 2,
  totalChunks: 4,
  embeddingModel: 'old-model',
  lastUpdated: 1,
};

beforeEach(() => {
  store.getMeta.mockReset();
  store.clearBook.mockClear();
  store.saveChunks.mockClear();
  store.saveBM25Index.mockClear();
  store.saveMeta.mockClear();
  embedManyMock.mockReset();
  embedMock.mockReset();
  store.hybridSearch.mockClear();
});

describe('legacy PDF index page-number migration', () => {
  it('rejects a character-estimated index for PDF but retains it for books', async () => {
    store.getMeta.mockResolvedValue(oldMeta);
    expect(await isBookIndexed('pdf', true)).toBe(false);
    expect(await isBookIndexed('pdf', false)).toBe(true);

    store.getMeta.mockResolvedValue({ ...oldMeta, pageNumberScheme: 'pdf-section' });
    expect(await isBookIndexed('pdf', true)).toBe(true);
  });

  it('builds a PDF keyword index when the OpenAI-compatible endpoint has no usable embeddings', async () => {
    store.getMeta.mockResolvedValue(null);
    embedManyMock.mockRejectedValue(new Error('Embeddings unavailable'));
    const doc = document.implementation.createHTMLDocument();
    doc.body.textContent = 'The paper reports a physical page result. '.repeat(20);
    const book = {
      sections: [{ id: 'page-1', linear: 'yes', size: 900, createDocument: async () => doc }],
    };

    await expect(
      indexBook(book, 'pdf-keyword', settings, undefined, true),
    ).resolves.toBeUndefined();
    expect(store.saveBM25Index).toHaveBeenCalledTimes(1);
    expect(store.saveMeta).toHaveBeenCalledWith(
      expect.objectContaining({ embeddingModel: 'bm25-only', pageNumberScheme: 'pdf-section' }),
      expect.any(Function),
    );
    expect(store.saveChunks.mock.calls[0]?.[0]?.[0]?.embedding).toBeUndefined();
  });

  it('falls back to PDF keyword search for malformed embedding vectors', async () => {
    store.getMeta.mockResolvedValue(null);
    embedManyMock.mockImplementation(async ({ values }: { values: string[] }) => ({
      embeddings: values.map(() => [[1, 2]]),
    }));
    const doc = document.implementation.createHTMLDocument();
    doc.body.textContent = 'The paper reports a physical page result. '.repeat(20);
    const book = {
      sections: [{ id: 'page-1', linear: 'yes', size: 900, createDocument: async () => doc }],
    };

    await expect(
      indexBook(book, 'pdf-malformed', settings, undefined, true),
    ).resolves.toBeUndefined();
    expect(store.saveMeta).toHaveBeenCalledWith(
      expect.objectContaining({ embeddingModel: 'bm25-only' }),
      expect.any(Function),
    );
  });

  it('searches a keyword-only PDF without retrying the unavailable embedding endpoint', async () => {
    store.getMeta.mockResolvedValue({
      ...oldMeta,
      embeddingModel: 'bm25-only',
      pageNumberScheme: 'pdf-section',
    });
    await expect(hybridSearch('pdf', 'measured value', settings)).resolves.toEqual([]);
    expect(embedMock).not.toHaveBeenCalled();
    expect(store.hybridSearch).toHaveBeenCalledWith('pdf', null, 'measured value', 10, undefined);
  });

  it('keeps embedding failure fatal for non-PDF books', async () => {
    store.getMeta.mockResolvedValue(null);
    embedManyMock.mockRejectedValue(new Error('Embeddings unavailable'));
    const doc = document.implementation.createHTMLDocument();
    doc.body.textContent = 'A regular book chapter paragraph. '.repeat(20);
    const book = {
      sections: [{ id: 'page-1', linear: 'yes', size: 900, createDocument: async () => doc }],
    };

    await expect(indexBook(book, 'epub-no-embedding', settings, undefined, false)).rejects.toThrow(
      'Embeddings unavailable',
    );
    expect(store.saveBM25Index).not.toHaveBeenCalled();
  });

  it('clears stale PDF chunks before a replacement index and reports image-only PDFs', async () => {
    store.getMeta.mockResolvedValue(oldMeta);
    await expect(indexBook({ sections: [] }, 'pdf', settings, undefined, true)).rejects.toThrow(
      'no extractable text',
    );
    expect(store.clearBook).toHaveBeenCalledWith('pdf');
  });
});
