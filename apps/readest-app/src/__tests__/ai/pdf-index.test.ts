import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AISettings, BookIndexMeta } from '@/services/ai/types';

const store = vi.hoisted(() => ({
  getMeta: vi.fn(),
  clearBook: vi.fn(async () => {}),
}));

vi.mock('@/services/ai/storage/aiStore', () => ({ aiStore: store }));
vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({}),
}));

import { indexBook, isBookIndexed } from '@/services/ai/ragService';

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
});

describe('legacy PDF index page-number migration', () => {
  it('rejects a character-estimated index for PDF but retains it for books', async () => {
    store.getMeta.mockResolvedValue(oldMeta);
    expect(await isBookIndexed('pdf', true)).toBe(false);
    expect(await isBookIndexed('pdf', false)).toBe(true);

    store.getMeta.mockResolvedValue({ ...oldMeta, pageNumberScheme: 'pdf-section' });
    expect(await isBookIndexed('pdf', true)).toBe(true);
  });

  it('clears stale PDF chunks before a replacement index', async () => {
    store.getMeta.mockResolvedValue(oldMeta);
    await indexBook({ sections: [] }, 'pdf', settings, undefined, true);
    expect(store.clearBook).toHaveBeenCalledWith('pdf');
  });
});
