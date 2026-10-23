import { describe, expect, it } from 'vitest';
import { aiAccountScope } from '@/services/ai/accountScope';
import { aiStore } from '@/services/ai/storage/aiStore';
import {
  deleteBookAiData,
  queueBookAiDataDeletion,
  retryPendingBookAiDataDeletions,
} from '@/services/ai/deleteBookAiData';
import type { AIConversation, BookIndexMeta, TextChunk } from '@/services/ai/types';

describe('AI IndexedDB account isolation and deletion', () => {
  it('removes only the chosen account index and conversation', async () => {
    const paper = crypto.randomUUID();
    const a = aiAccountScope(paper, 'account-a');
    const b = aiAccountScope(paper, 'account-b');
    const meta = (bookHash: string): BookIndexMeta => ({
      bookHash,
      bookTitle: 'Paper',
      authorName: 'Researcher',
      totalSections: 1,
      totalChunks: 1,
      embeddingModel: 'test',
      pageNumberScheme: 'pdf-section',
      lastUpdated: 1,
    });
    const chunk = (bookHash: string): TextChunk => ({
      id: bookHash + '-0',
      bookHash,
      sectionIndex: 0,
      chapterTitle: 'Page 1',
      text: 'Private evidence for ' + bookHash,
      pageNumber: 1,
    });
    const conversation = (id: string, bookHash: string): AIConversation => ({
      id,
      bookHash,
      title: 'Private chat',
      createdAt: 1,
      updatedAt: 1,
    });
    try {
      for (const scope of [a, b]) {
        await aiStore.saveMeta(meta(scope));
        await aiStore.saveChunks([chunk(scope)]);
        await aiStore.saveConversation(conversation(scope + '-chat', scope));
        await aiStore.saveMessage({
          id: scope + '-message',
          conversationId: scope + '-chat',
          role: 'user',
          content: 'Private note',
          createdAt: 1,
        });
      }
      expect(await aiStore.getChunks(a)).toHaveLength(1);
      expect(await aiStore.getChunks(b)).toHaveLength(1);
      expect(await aiStore.getConversations(a)).toHaveLength(1);
      expect(await aiStore.getConversations(b)).toHaveLength(1);

      const web = { appPlatform: 'web' } as Parameters<typeof deleteBookAiData>[2];
      queueBookAiDataDeletion(paper, 'account-a');
      await deleteBookAiData(paper, 'account-a', web);

      expect(await aiStore.getMeta(a)).toBeNull();
      expect(await aiStore.getChunks(a)).toEqual([]);
      expect(await aiStore.getConversations(a)).toEqual([]);
      expect(await aiStore.getMessages(a + '-chat')).toEqual([]);
      expect(await aiStore.getMeta(b)).not.toBeNull();
      expect(await aiStore.getChunks(b)).toHaveLength(1);
      expect(await aiStore.getConversations(b)).toHaveLength(1);
      expect(await aiStore.getMessages(b + '-chat')).toHaveLength(1);
    } finally {
      await aiStore.clearBook(a);
      await aiStore.clearBook(b);
      await aiStore.deleteConversation(a + '-chat');
      await aiStore.deleteConversation(b + '-chat');
    }
  });

  it('retries a pending account-scoped deletion after restart', async () => {
    const paper = crypto.randomUUID();
    const scope = aiAccountScope(paper, 'account-a');
    await aiStore.saveMeta({
      bookHash: scope,
      bookTitle: 'Paper',
      authorName: 'Researcher',
      totalSections: 0,
      totalChunks: 0,
      embeddingModel: 'test',
      lastUpdated: 1,
    });
    const web = { appPlatform: 'web' } as Parameters<typeof deleteBookAiData>[2];
    try {
      queueBookAiDataDeletion(paper, 'account-a');
      await retryPendingBookAiDataDeletions(web);
      expect(await aiStore.getMeta(scope)).toBeNull();
      expect(
        Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((key) =>
          key?.startsWith('scholar-ai-pending-book-delete:'),
        ),
      ).toEqual([]);
    } finally {
      await aiStore.clearBook(scope);
    }
  });
});
