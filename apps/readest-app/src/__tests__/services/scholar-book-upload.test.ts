import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';
const register = vi.fn();
const versionUpload = vi.fn();
const legacyUpload = vi.fn();
const saveBaseline = vi.fn();
const accountId = '00000000-0000-4000-8000-000000000001';
const fileId = '00000000-0000-4000-8000-000000000002';
const versionId = '00000000-0000-4000-8000-000000000003';
const opId = '00000000-0000-4000-8000-000000000004';
vi.mock('@/services/environment', async (original) => ({
  ...(await original<typeof import('@/services/environment')>()),
  isScholarReleaseBundle: () => true,
}));
vi.mock('@/services/scholarFileBaseline', () => ({
  getScholarAccountId: async () => accountId,
  getScholarFileBaseline: () => undefined,
  saveScholarFileBaseline: (...args: unknown[]) => saveBaseline(...args),
}));
vi.mock('@/utils/fetch', () => ({ fetchWithAuth: (...args: unknown[]) => register(...args) }));
vi.mock('@/libs/scholarFileVersion', () => ({ uploadScholarFileVersion: (...args: unknown[]) => versionUpload(...args) }));
vi.mock('@/libs/storage', () => ({
  uploadFile: (...args: unknown[]) => legacyUpload(...args),
  createProgressHandler: () => vi.fn(),
}));
vi.mock('@/utils/book', () => ({
  getLocalBookFilename: () => 'hash/paper.pdf',
  getRemoteBookFilename: () => 'hash/paper.pdf',
  getCoverFilename: () => 'hash/cover.png',
}));
vi.mock('@/services/bookContent', () => ({
  resolveBookContentSource: async () => ({ kind: 'managed', path: 'hash/paper.pdf', base: 'Books' }),
  isBookFileContentSource: () => true,
}));
import { uploadBook } from '@/services/cloudService';
const book = (): Book => ({ hash: 'hash', format: 'PDF', title: 'Paper', author: 'Author',
  createdAt: 1, updatedAt: 1, uploadedAt: null });
const fs = {
  exists: vi.fn(async (path: string) => path !== 'hash/cover.png'),
  openFile: vi.fn(async () => new File(['paper'], 'paper.pdf')),
} as unknown as FileSystem;
const path = vi.fn(async () => '/managed/hash/paper.pdf');
beforeEach(() => {
  register.mockReset().mockResolvedValue(new Response(JSON.stringify({ fileId, activeVersionId: null }), { status: 200 }));
  versionUpload.mockReset().mockResolvedValue({ versionId, applied: true, activeVersionId: versionId });
  legacyUpload.mockReset(); saveBaseline.mockReset();
});
describe('Scholar book upload', () => {
  it('registers once, sends immutable version with captured CAS base, then records baseline', async () => {
    const item = book();
    await uploadBook(fs, path, item, undefined, { accountId, opId, expectedVersionId: null });
    expect(register).toHaveBeenCalledWith(expect.stringContaining('/scholar/files/register'), expect.objectContaining({ method: 'POST' }));
    expect(versionUpload).toHaveBeenCalledWith(expect.any(File), fileId, opId, null, expect.any(Function), '/managed/hash/paper.pdf');
    expect(legacyUpload).not.toHaveBeenCalled();
    expect(saveBaseline).toHaveBeenCalledWith(accountId, 'Readest/Books/hash/paper.pdf', { fileId, versionId });
    expect(item.uploadedAt).toBeTypeOf('number');
  });
  it('keeps local book unstamped and baseline unchanged after losing CAS', async () => {
    versionUpload.mockResolvedValue({ versionId, applied: false, activeVersionId: fileId });
    const item = book();
    await expect(uploadBook(fs, path, item, undefined, { accountId, opId, expectedVersionId: null }))
      .rejects.toThrow('Scholar file conflict');
    expect(saveBaseline).not.toHaveBeenCalled();
    expect(item.uploadedAt).toBeNull();
  });
});
