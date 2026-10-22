import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';
import { isBookFileContentSource, resolveBookContentSource } from './bookContent';

/** Copy the queued body into private Cache before an operation ID reaches the server. */
export async function createScholarUploadSnapshot(
  fs: FileSystem,
  book: Book,
  path: string,
): Promise<number> {
  const source = await resolveBookContentSource(fs, book);
  if (!isBookFileContentSource(source)) throw new Error('Scholar upload source is unavailable; requeue');
  const directory = path.slice(0, path.lastIndexOf('/'));
  await fs.createDir(directory, 'Cache', true);
  try {
    let expectedSize: number | null = null;
    if (source.kind === 'url') {
      const file = await fs.openFile(source.path, source.base, undefined, source.fetcher);
      try {
        expectedSize = file.size;
        await fs.writeFile(path, 'Cache', file);
      } finally {
        const opened = file as File & { close?: () => Promise<void> | void };
        if (opened.close) await opened.close();
      }
    } else {
      const before = await fs.stats(source.path, source.base);
      if (!before.isFile || before.size <= 0) throw new Error('Scholar upload source is empty');
      expectedSize = before.size;
      await fs.copyFile(source.path, source.base, path, 'Cache');
      const after = await fs.stats(source.path, source.base);
      if (before.size !== after.size ||
          (before.mtime && after.mtime && before.mtime.getTime() !== after.mtime.getTime())) {
        throw new Error('Scholar upload source changed during snapshot; requeue');
      }
    }
    const snapshot = await fs.stats(path, 'Cache');
    if (!snapshot.isFile || snapshot.size <= 0 || snapshot.size !== expectedSize) {
      throw new Error('Scholar upload snapshot size mismatch; requeue');
    }
    return snapshot.size;
  } catch (error) {
    await fs.removeFile(path, 'Cache').catch(() => {});
    throw error;
  }
}
