import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ScholarThreePane from '@/app/library/components/ScholarThreePane';
import type { Book } from '@/types/book';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

vi.mock('@/utils/book', () => ({
  formatAuthors: (author: string) => author,
  formatDate: (date: string) => date,
}));

vi.mock('@/app/library/components/ScholarTranslationPanel', () => ({
  default: () => <div data-testid='translation-panel' />,
}));

vi.mock('@/components/metadata/BookDetailView', () => ({
  default: ({ book }: { book: Book }) => <div data-testid='book-details'>{book.title}</div>,
}));

const book = (hash: string, title: string, groupName: string): Book => ({
  hash,
  title,
  groupName,
  format: 'PDF',
  author: 'Researcher',
  createdAt: 1,
  updatedAt: 1,
});

afterEach(cleanup);

describe('Scholar three-pane library', () => {
  it('filters by collection and opens or edits the selected book', () => {
    const onOpenBook = vi.fn();
    const onShowDetails = vi.fn();
    const books = [
      book('a', 'Paper A', 'Research/Batch A'),
      book('b', 'Paper B', 'Research/Batch B'),
      book('c', 'Paper C', 'Research/Batch B'),
    ];

    render(
      <ScholarThreePane
        books={books}
        collectionPaths={['Research/Empty']}
        onOpenBook={onOpenBook}
        onShowDetails={onShowDetails}
        onDownload={vi.fn()}
        onUpload={vi.fn()}
      />,
    );

    const collections = screen.getByRole('navigation', { name: 'Collections' });
    fireEvent.click(within(collections).getByRole('button', { name: 'Research/Batch B (2)' }));
    const list = screen.getByRole('region', { name: 'Books' });
    expect(within(list).queryByText('Paper A')).toBeNull();
    expect(within(list).getByText('Paper B')).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: /Paper C/ }));
    expect(screen.getByTestId('book-details').textContent).toBe('Paper C');
    expect(screen.getByTestId('translation-panel')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open Book' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Metadata' }));
    expect(onOpenBook).toHaveBeenCalledWith(books[2]);
    expect(onShowDetails).toHaveBeenCalledWith(books[2]);

    fireEvent.click(within(collections).getByRole('button', { name: 'Research/Empty (0)' }));
    expect(screen.getByText('No books in this collection.')).toBeTruthy();
    expect(screen.getByText('Select a book to view details.')).toBeTruthy();
  });
});
