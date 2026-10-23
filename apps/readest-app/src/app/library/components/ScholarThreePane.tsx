import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAuthors, formatDate } from '@/utils/book';
import {
  buildScholarCollectionTree,
  selectScholarCollectionBooks,
} from '@/services/scholar/threePane';
import BookDetailView from '@/components/metadata/BookDetailView';

interface ScholarThreePaneProps {
  books: Book[];
  collectionPaths: string[];
  onOpenBook: (book: Book) => void;
  onShowDetails: (book: Book) => void;
  onDownload: (book: Book) => void;
  onUpload: (book: Book) => void;
}

const ScholarThreePane = ({
  books,
  collectionPaths,
  onOpenBook,
  onShowDetails,
  onDownload,
  onUpload,
}: ScholarThreePaneProps) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const collections = useMemo(
    () => buildScholarCollectionTree(books, collectionPaths),
    [books, collectionPaths],
  );
  const visibleBooks = useMemo(
    () =>
      selectScholarCollectionBooks(books, selectedPath).sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { numeric: true }),
      ),
    [books, selectedPath],
  );
  const selectedBook = visibleBooks.find((book) => book.hash === selectedHash) ?? visibleBooks[0];

  useEffect(() => {
    let active = true;
    setFileSize(null);
    if (selectedBook && appService) {
      void appService.getBookFileSize(selectedBook).then((size) => {
        if (active) setFileSize(size);
      });
    }
    return () => {
      active = false;
    };
  }, [selectedBook, appService]);

  return (
    <div className='grid min-h-0 flex-1 grid-cols-[minmax(12rem,18%)_minmax(17rem,32%)_minmax(0,1fr)] border-t border-base-300 bg-base-100'>
      <nav
        aria-label={_('Collections')}
        className='min-h-0 overflow-y-auto border-e border-base-300 p-3'
      >
        <h2 className='px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-base-content/60'>
          {_('Collections')}
        </h2>
        <button
          type='button'
          aria-label={`${_('All')} (${books.filter((book) => !book.deletedAt).length})`}
          aria-current={selectedPath === null ? 'page' : undefined}
          className={clsx(
            'eink-bordered flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-start text-sm',
            selectedPath === null ? 'bg-base-300 font-semibold' : 'hover:bg-base-200',
          )}
          onClick={() => setSelectedPath(null)}
        >
          <span>{_('All')}</span>
          <span className='text-base-content/55'>
            {books.filter((book) => !book.deletedAt).length}
          </span>
        </button>
        {collections.map((collection) => (
          <button
            key={collection.path}
            type='button'
            title={collection.path}
            aria-label={`${collection.path} (${collection.count})`}
            aria-current={selectedPath === collection.path ? 'page' : undefined}
            className={clsx(
              'eink-bordered flex min-h-10 w-full items-center justify-between gap-2 rounded-lg pe-2 text-start text-sm',
              selectedPath === collection.path ? 'bg-base-300 font-semibold' : 'hover:bg-base-200',
            )}
            style={{ paddingInlineStart: `${12 + collection.depth * 16}px` }}
            onClick={() => setSelectedPath(collection.path)}
          >
            <span className='truncate'>{collection.name}</span>
            <span className='shrink-0 text-base-content/55'>{collection.count}</span>
          </button>
        ))}
      </nav>

      <section aria-label={_('Books')} className='min-h-0 overflow-y-auto border-e border-base-300'>
        <h2 className='sticky top-0 z-10 border-b border-base-300 bg-base-100 px-4 py-3 text-sm font-semibold'>
          {selectedPath ?? _('All')}{' '}
          <span className='text-base-content/55'>({visibleBooks.length})</span>
        </h2>
        {visibleBooks.map((book) => (
          <button
            key={book.hash}
            type='button'
            aria-current={selectedBook?.hash === book.hash ? 'true' : undefined}
            className={clsx(
              'w-full border-b border-base-200 px-4 py-3 text-start focus-visible:outline-2 focus-visible:outline-offset-[-2px]',
              selectedBook?.hash === book.hash ? 'bg-base-200' : 'hover:bg-base-200/60',
            )}
            onClick={() => setSelectedHash(book.hash)}
            onDoubleClick={() => onOpenBook(book)}
          >
            <span className='block truncate text-sm font-semibold'>{book.title}</span>
            <span className='mt-1 block truncate text-xs text-base-content/65'>
              {formatAuthors(book.author, book.primaryLanguage) || _('Unknown')}
              {book.metadata?.published ? ` · ${formatDate(book.metadata.published, true)}` : ''}
            </span>
          </button>
        ))}
        {visibleBooks.length === 0 && (
          <p className='p-5 text-sm text-base-content/60'>{_('No books in this collection.')}</p>
        )}
      </section>

      <aside aria-label={_('Book Details')} className='min-h-0 overflow-y-auto p-4'>
        {selectedBook ? (
          <>
            <div className='mb-4 flex flex-wrap gap-2'>
              <button
                type='button'
                className='btn btn-contrast min-h-9'
                onClick={() => onOpenBook(selectedBook)}
              >
                {_('Open Book')}
              </button>
              <button
                type='button'
                className='btn btn-ghost eink-bordered min-h-9'
                onClick={() => onShowDetails(selectedBook)}
              >
                {_('Edit Metadata')}
              </button>
            </div>
            <BookDetailView
              key={selectedBook.hash}
              book={selectedBook}
              metadata={selectedBook.metadata ?? null}
              fileSize={fileSize}
              onEdit={() => onShowDetails(selectedBook)}
              onDownload={() => onDownload(selectedBook)}
              onUpload={() => onUpload(selectedBook)}
            />
          </>
        ) : (
          <p className='text-sm text-base-content/60'>{_('Select a book to view details.')}</p>
        )}
      </aside>
    </div>
  );
};

export default ScholarThreePane;
