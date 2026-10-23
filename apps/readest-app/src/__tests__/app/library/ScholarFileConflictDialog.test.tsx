import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Book } from '@/types/book';
import type { TransferItem } from '@/store/transferStore';

const getScholarAccountId = vi.fn();
const fetchWithAuth = vi.fn();
const finishScholarConflict = vi.fn();
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/services/scholarFileBaseline', () => ({
  getScholarAccountId: (...args: unknown[]) => getScholarAccountId(...args),
}));
vi.mock('@/utils/fetch', () => ({ fetchWithAuth: (...args: unknown[]) => fetchWithAuth(...args) }));
vi.mock('@/services/environment', () => ({ getAPIBaseUrl: () => '/api' }));
vi.mock('@/services/transferManager', () => ({
  transferManager: { finishScholarConflict: (...args: unknown[]) => finishScholarConflict(...args) },
}));

import ScholarFileConflictDialog from '@/app/library/components/ScholarFileConflictDialog';

const accountId = '00000000-0000-4000-8000-000000000001';
const fileId = '00000000-0000-4000-8000-000000000002';
const cloudVersion = '00000000-0000-4000-8000-000000000003';
const localVersion = '00000000-0000-4000-8000-000000000004';
const opId = '00000000-0000-4000-8000-000000000005';
const book = {
  hash: 'book-hash', title: 'Paper', author: 'Author', format: 'PDF',
  createdAt: 1, updatedAt: 1,
} as Book;
const transfer = {
  id: 'transfer-1', kind: 'book', type: 'upload', status: 'failed', bookHash: book.hash,
  bookTitle: book.title, scholarAccountId: accountId, scholarOpId: opId,
  error: 'Scholar file conflict; local version retained',
} as TransferItem;
const response = (data: unknown) => ({ json: vi.fn().mockResolvedValue(data) });
const version = (versionId: string, versionOpId: string, digest: string) => ({
  versionId, opId: versionOpId, sha256: digest, fileSize: 17, verifiedAt: '2026-10-23T00:00:00Z',
});

beforeEach(() => {
  getScholarAccountId.mockReset().mockResolvedValue(accountId);
  finishScholarConflict.mockReset().mockResolvedValue(undefined);
  fetchWithAuth.mockReset()
    .mockResolvedValueOnce(response({ fileId, activeVersionId: cloudVersion }))
    .mockResolvedValueOnce(response({
      fileId, activeVersionId: cloudVersion,
      versions: [version(cloudVersion, 'other-op', 'a'.repeat(64)), version(localVersion, opId, 'b'.repeat(64))],
    }));
});
afterEach(cleanup);

describe('Scholar file conflict dialog', () => {
  it('shows both verified versions and publishes the selected local bytes with CAS', async () => {
    fetchWithAuth.mockResolvedValueOnce(response({ activeVersionId: localVersion }));
    render(<ScholarFileConflictDialog transfer={transfer} book={book} onClose={vi.fn()} />);
    expect(await screen.findByText('Cloud version')).toBeTruthy();
    expect(screen.getByText('This upload')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use this upload' }));
    await waitFor(() => expect(finishScholarConflict).toHaveBeenCalledWith(
      transfer.id, fileId, localVersion, true,
    ));
    expect(fetchWithAuth).toHaveBeenLastCalledWith('/api/scholar/files/restore', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ fileId, versionId: localVersion, expectedVersionId: cloudVersion }),
    }));
  });

  it('can keep the current cloud head without publishing the conflicting upload', async () => {
    fetchWithAuth.mockResolvedValueOnce(response({ activeVersionId: cloudVersion }));
    render(<ScholarFileConflictDialog transfer={transfer} book={book} onClose={vi.fn()} />);
    await screen.findByText('Cloud version');
    fireEvent.click(screen.getByRole('button', { name: 'Keep cloud version' }));
    await waitFor(() => expect(finishScholarConflict).toHaveBeenCalledWith(
      transfer.id, fileId, cloudVersion, false,
    ));
    expect(fetchWithAuth).toHaveBeenLastCalledWith('/api/scholar/files/restore', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ fileId, versionId: cloudVersion, expectedVersionId: cloudVersion }),
    }));
  });

  it('does not mark resolved if the cloud head changed during review', async () => {
    fetchWithAuth.mockRejectedValueOnce(new Error('File changed since review'));
    render(<ScholarFileConflictDialog transfer={transfer} book={book} onClose={vi.fn()} />);
    await screen.findByText('Cloud version');
    fireEvent.click(screen.getByRole('button', { name: 'Use this upload' }));
    expect(await screen.findByText('File changed since review')).toBeTruthy();
    expect(finishScholarConflict).not.toHaveBeenCalled();
  });
});
