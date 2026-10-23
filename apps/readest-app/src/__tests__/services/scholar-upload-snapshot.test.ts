import { describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';
import { createScholarUploadSnapshot } from '@/services/scholarUploadSnapshot';

vi.mock('@/services/bookContent', () => ({
  resolveBookContentSource: async () => ({ kind: 'managed', path: 'paper.pdf', base: 'Books' }),
  isBookFileContentSource: () => true,
}));

const book = { hash: 'paper', format: 'PDF', title: 'Paper' } as Book;
const fileInfo = (size: number, mtime = new Date(1)) => ({
  isFile: true,
  isDirectory: false,
  size,
  mtime,
  atime: null,
  birthtime: null,
});

function memoryFs(sourceBytes: Uint8Array) {
  let snapshotBytes: Uint8Array | null = null;
  const fs = {
    createDir: vi.fn(async () => {}),
    copyFile: vi.fn(async () => {
      snapshotBytes = sourceBytes.slice();
    }),
    stats: vi.fn(async (_path: string, base: string) =>
      fileInfo(base === 'Cache' ? (snapshotBytes?.length ?? 0) : sourceBytes.length),
    ),
    removeFile: vi.fn(async () => {
      snapshotBytes = null;
    }),
  } as unknown as FileSystem;
  return { fs, bytes: () => snapshotBytes };
}

describe('Scholar upload snapshot', () => {
  it('copies source bytes into Cache before resolving, independent of later edits', async () => {
    const source = new Uint8Array([1, 2, 3]);
    const { fs, bytes } = memoryFs(source);
    const size = await createScholarUploadSnapshot(fs, book, 'scholar-uploads/account/op');
    source[0] = 9;
    expect(size).toBe(3);
    expect(Array.from(bytes()!)).toEqual([1, 2, 3]);
    expect(fs.copyFile).toHaveBeenCalledWith(
      'paper.pdf',
      'Books',
      'scholar-uploads/account/op',
      'Cache',
    );
  });

  it('removes a partial copy when the destination is shorter than the source', async () => {
    const { fs } = memoryFs(new Uint8Array([1, 2, 3]));
    vi.mocked(fs.copyFile).mockImplementationOnce(async () => {});
    await expect(
      createScholarUploadSnapshot(fs, book, 'scholar-uploads/account/op'),
    ).rejects.toThrow('snapshot size mismatch');
    expect(fs.removeFile).toHaveBeenCalledWith('scholar-uploads/account/op', 'Cache');
  });

  it('rejects and removes a copy when the source changes during staging', async () => {
    const source = new Uint8Array([1, 2, 3]);
    const { fs } = memoryFs(source);
    vi.mocked(fs.copyFile).mockImplementationOnce(async () => {
      source[2] = 4;
    });
    vi.mocked(fs.stats)
      .mockResolvedValueOnce(fileInfo(3, new Date(1)))
      .mockResolvedValueOnce(fileInfo(3, new Date(2)));
    await expect(
      createScholarUploadSnapshot(fs, book, 'scholar-uploads/account/op'),
    ).rejects.toThrow('source changed during snapshot');
    expect(fs.removeFile).toHaveBeenCalledWith('scholar-uploads/account/op', 'Cache');
  });
});
