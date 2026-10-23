/** @vitest-environment node */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { ReedyDb } from '@/services/reedy/db/ReedyDb';
import { MemoryService } from '@/services/reedy/memory/MemoryService';
import type { EmbeddingModel } from '@/services/reedy/models/EmbeddingModel';
import type { ChunkRow } from '@/services/reedy/db/types';

function chunk(bookHash: string): ChunkRow {
  return {
    id: bookHash + '-chunk',
    bookHash,
    sectionIndex: 0,
    chapterTitle: 'Page 1',
    startCfi: '/1',
    endCfi: '/2',
    positionIndex: 0,
    text: 'old indexing work',
    tokenCount: 3,
  };
}

describe('Reedy deletion fence across database connections', () => {
  it('rejects a write queued before purge but submitted after it, including after reimport', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scholar-reedy-fence-'));
    const path = join(dir, 'reedy.db');
    const writerDb = await NodeDatabaseService.open(path, { experimental: ['index_method'] });
    const deleterDb = await NodeDatabaseService.open(path, { experimental: ['index_method'] });
    try {
      await migrate(writerDb, getMigrations('reedy'));
      const writer = new ReedyDb(writerDb);
      const deleter = new ReedyDb(deleterDb);
      const generation = await writer.beginBookIndex('book-one');
      const originalBatch = writerDb.batch.bind(writerDb);
      let release!: () => void;
      let entered!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const atBatch = new Promise<void>((resolve) => {
        entered = resolve;
      });
      writerDb.batch = async (statements: string[]) => {
        entered();
        await blocked;
        return originalBatch(statements);
      };
      const staleWrite = writer.insertChunks([chunk('book-one')], generation);
      await atBatch;
      await deleter.purgeBookData('book-one');
      await expect(deleter.beginBookIndex('book-one')).rejects.toThrow(/deleted/i);
      await deleter.reopenImportedBook('book-one');
      release();
      await expect(staleWrite).rejects.toThrow(/changed|deleted/i);
      const rows = await deleterDb.select<{ id: string }>(
        'SELECT id FROM reedy_book_chunks WHERE book_hash = ?',
        ['book-one'],
      );
      expect(rows).toHaveLength(0);

      const newGeneration = await deleter.beginBookIndex('book-one');
      await deleter.insertChunks([chunk('book-one')], newGeneration);
      expect(
        await deleterDb.select('SELECT id FROM reedy_book_chunks WHERE book_hash = ?', [
          'book-one',
        ]),
      ).toHaveLength(1);
      await deleter.purgeBookData('book-one');
      expect(
        await deleterDb.select('SELECT id FROM reedy_book_chunks WHERE book_hash = ?', [
          'book-one',
        ]),
      ).toHaveLength(0);
    } finally {
      await writerDb.close();
      await deleterDb.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('rejects an old assistant memory write after deletion and reimport', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scholar-reedy-memory-fence-'));
    const path = join(dir, 'reedy.db');
    const writerDb = await NodeDatabaseService.open(path, { experimental: ['index_method'] });
    const deleterDb = await NodeDatabaseService.open(path, { experimental: ['index_method'] });
    try {
      await migrate(writerDb, getMigrations('reedy'));
      const writer = new ReedyDb(writerDb);
      const deleter = new ReedyDb(deleterDb);
      const oldGeneration = await writer.captureBookGeneration('book-one');
      const model: EmbeddingModel = {
        id: 'test',
        dim: 4,
        async embed(texts) {
          return texts.map(() => [1, 0, 0, 0]);
        },
      };
      const oldAssistant = new MemoryService(writer, model, 'book-one', oldGeneration);
      await deleter.purgeBookData('book-one');
      await deleter.reopenImportedBook('book-one');

      await expect(
        oldAssistant.write({
          scope: 'book',
          scopeKey: 'book-one',
          key: 'stale',
          summary: 'old private fact',
        }),
      ).rejects.toThrow(/changed|deleted/i);
      expect(await deleter.listMemories('book', 'book-one', 10)).toEqual([]);

      const newGeneration = await deleter.captureBookGeneration('book-one');
      await deleter.reopenImportedBook('book-one');
      expect(await deleter.captureBookGeneration('book-one')).toBe(newGeneration);
      const newAssistant = new MemoryService(deleter, model, 'book-one', newGeneration);
      await newAssistant.write({
        scope: 'book',
        scopeKey: 'book-one',
        key: 'fresh',
        summary: 'new private fact',
      });
      expect((await deleter.listMemories('book', 'book-one', 10)).map((row) => row.key)).toEqual([
        'fresh',
      ]);
      const vectors = await deleterDb.select('SELECT memory_id FROM reedy_memory_embeddings');
      expect(vectors).toHaveLength(1);
    } finally {
      await writerDb.close();
      await deleterDb.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
