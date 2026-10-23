import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Book } from '@/types/book';
import type { TransferItem } from '@/store/transferStore';

const getScholarAccountId = vi.fn();
const fetchWithAuth = vi.fn();
const keepCloud = vi.fn();
const requeueDelete = vi.fn();
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/services/scholarFileBaseline', () => ({
  getScholarAccountId: () => getScholarAccountId(),
}));
vi.mock('@/utils/fetch', () => ({ fetchWithAuth: (...args: unknown[]) => fetchWithAuth(...args) }));
vi.mock('@/services/environment', () => ({ getAPIBaseUrl: () => '/api' }));
vi.mock('@/services/transferManager', () => ({
  transferManager: {
    keepScholarCloudAfterDeleteConflict: (...args: unknown[]) => keepCloud(...args),
    requeueScholarDeleteConflict: (...args: unknown[]) => requeueDelete(...args),
  },
}));

import ScholarFileDeleteConflictDialog from '@/app/library/components/ScholarFileDeleteConflictDialog';

const accountId = '00000000-0000-4000-8000-000000000001';
const fileId = '00000000-0000-4000-8000-000000000002';
const activeVersionId = '00000000-0000-4000-8000-000000000003';
const book = { hash: 'book-hash', title: 'Paper', deletedAt: 1 } as Book;
const transfer = {
  id: 'task-1', kind: 'book', type: 'delete', status: 'failed', bookHash: book.hash,
  scholarAccountId: accountId,
  scholarFilePath: 'Readest/Books/book-hash/Paper.pdf',
  scholarOpId: '00000000-0000-4000-8000-000000000004',
  error: 'Scholar delete conflict; remote version retained',
} as TransferItem;
const response = (data: unknown) => ({ json: vi.fn().mockResolvedValue(data) });

beforeEach(() => {
  getScholarAccountId.mockReset().mockResolvedValue(accountId);
  keepCloud.mockReset().mockResolvedValue(undefined);
  requeueDelete.mockReset().mockResolvedValue(undefined);
  fetchWithAuth.mockReset()
    .mockResolvedValueOnce(response({ fileId, activeVersionId }))
    .mockResolvedValueOnce(response({
      fileId, activeVersionId,
      versions: [{
        versionId: activeVersionId, sha256: 'a'.repeat(64),
        fileSize: 90000, verifiedAt: '2026-10-23T00:00:00Z',
      }],
    }));
});
afterEach(cleanup);

describe('Scholar file delete conflict dialog', () => {
  it('shows the verified current cloud version and can keep it', async () => {
    render(<ScholarFileDeleteConflictDialog transfer={transfer} book={book} onClose={vi.fn()} />);
    expect(await screen.findByText('Current cloud version')).toBeTruthy();
    expect(screen.getByText(/SHA-256: aaaaaaaa/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep cloud file' }));
    await waitFor(() => expect(keepCloud).toHaveBeenCalledWith(
      transfer.id, fileId, activeVersionId,
    ));
    expect(requeueDelete).not.toHaveBeenCalled();
  });

  it('starts a new reviewed delete operation for the current cloud head', async () => {
    render(<ScholarFileDeleteConflictDialog transfer={transfer} book={book} onClose={vi.fn()} />);
    await screen.findByText('Current cloud version');
    fireEvent.click(screen.getByRole('button', { name: 'Delete current cloud version' }));
    await waitFor(() => expect(requeueDelete).toHaveBeenCalledWith(
      transfer.id, fileId, activeVersionId,
    ));
    expect(keepCloud).not.toHaveBeenCalled();
  });

  it('does not offer an action if the version changed during review', async () => {
    fetchWithAuth.mockReset()
      .mockResolvedValueOnce(response({ fileId, activeVersionId }))
      .mockResolvedValueOnce(response({
        fileId, activeVersionId: 'different', versions: [],
      }));
    render(<ScholarFileDeleteConflictDialog transfer={transfer} book={book} onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep cloud file' }).hasAttribute('disabled')).toBe(true);
    expect(keepCloud).not.toHaveBeenCalled();
  });
});
