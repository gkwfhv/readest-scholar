import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppService, FileSystem } from '@/types/system';
import type { Book } from '@/types/book';

const accountId = '00000000-0000-4000-8000-000000000001';
const fileId = '00000000-0000-4000-8000-000000000002';
const versionId = '00000000-0000-4000-8000-000000000003';
const saveBaseline = vi.fn();
const api = vi.fn();
const download = vi.fn();
const files = new Map<string, Uint8Array>();
const payload = new TextEncoder().encode('verified paper');
let expectedHash = '';
vi.mock('@/services/environment', async (original) => ({
  ...(await original<typeof import('@/services/environment')>()),
  isScholarReleaseBundle: () => true,
}));
vi.mock('@/services/scholarFileBaseline', () => ({
  getScholarAccountId: async () => accountId,
  getScholarFileBaseline: () => undefined,
  saveScholarFileBaseline: (...args: unknown[]) => saveBaseline(...args),
}));
vi.mock('@/utils/fetch', () => ({ fetchWithAuth: (...args: unknown[]) => api(...args) }));
vi.mock('@/libs/storage', () => ({
  downloadFile: (...args: unknown[]) => download(...args),
  createProgressHandler: () => vi.fn(),
}));
vi.mock('@/utils/book', () => ({
  getDir: () => 'hash',
  getLocalBookFilename: () => 'hash/paper.pdf',
  getRemoteBookFilename: () => 'hash/paper.pdf',
  getCoverFilename: () => 'hash/cover.png',
}));
import { sha256File } from '@/services/dictionaries/plugins/integrity';
import { downloadBook } from '@/services/cloudService';

const book = (): Book => ({ hash: 'hash', format: 'PDF', title: 'Paper', author: 'Author',
  createdAt: 1, updatedAt: 1, downloadedAt: null });
const fs = {
  exists: vi.fn(async (path: string) => ['hash', 'hash/cover.png'].includes(path) || files.has(path)),
  openFile: vi.fn(async (path: string) => new File([Uint8Array.from(files.get(path) ?? [])], path)),
  copyFile: vi.fn(async (source: string, _sourceBase: string, destination: string) => {
    const value = files.get(source);
    if (!value) throw new Error('Missing staged bytes');
    files.set(destination, value);
  }),
  removeFile: vi.fn(async (path: string) => { files.delete(path); }),
} as unknown as FileSystem;
const appService = {} as AppService;

beforeEach(async () => {
  files.clear();
  vi.clearAllMocks();
  expectedHash = await sha256File(new File([payload], 'paper.pdf'));
  api.mockImplementation(async (url: string) => new Response(JSON.stringify(
    url.includes('/status?')
      ? { fileId, activeVersionId: versionId }
      : { versionId, downloadUrl: 'http://object/immutable', sha256: expectedHash, fileSize: payload.length },
  ), { status: 200 }));
  download.mockImplementation(async ({ dst }: { dst: string }) => { files.set(dst, payload); });
});

describe('Scholar book download', () => {
  it('pins the exact head, checks bytes, then records the verified baseline', async () => {
    const item = book();
    await downloadBook(appService, fs, '/books', item);
    expect(api).toHaveBeenCalledWith(expect.stringContaining('/scholar/files/status?'), expect.any(Object));
    expect(api).toHaveBeenCalledWith(expect.stringContaining(`versionId=${versionId}`), expect.any(Object));
    expect(files.get('/books/hash/paper.pdf')).toEqual(payload);
    expect(saveBaseline).toHaveBeenCalledWith(accountId, 'Readest/Books/hash/paper.pdf', { fileId, versionId });
    expect(item.downloadedAt).toBeTypeOf('number');
  });
  it('rejects corrupted bytes without replacing a book or accepting the baseline', async () => {
    download.mockImplementation(async ({ dst }: { dst: string }) => { files.set(dst, new TextEncoder().encode('bad')); });
    const item = book();
    await expect(downloadBook(appService, fs, '/books', item)).rejects.toThrow('hash mismatch');
    expect(files.has('/books/hash/paper.pdf')).toBe(false);
    expect(saveBaseline).not.toHaveBeenCalled();
    expect(item.downloadedAt).toBeNull();
  });
});
