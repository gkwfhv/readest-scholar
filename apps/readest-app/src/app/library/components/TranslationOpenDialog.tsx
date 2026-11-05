'use client';

import React from 'react';

import type { Book, TranslationOutputKind } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';

interface TranslationOpenDialogProps {
  book: Book;
  /** PDF kinds actually available (local file or fetchable server output). */
  kinds: TranslationOutputKind[];
  /** True when a derived Chinese EPUB exists or can be fetched. */
  translatedBook?: boolean;
  /** True while the translated copy is being downloaded on this device. */
  downloading?: boolean;
  onChoose: (choice: 'original' | TranslationOutputKind | 'epub') => void;
  onCancel: () => void;
}

/**
 * Asked on every open of a book that has a translation, so the choice is never
 * silently remembered. Only the forms the job produced are listed; canceling is
 * the same as opening the original.
 */
const TranslationOpenDialog: React.FC<TranslationOpenDialogProps> = ({
  book,
  kinds,
  translatedBook = false,
  downloading = false,
  onChoose,
  onCancel,
}) => {
  const _ = useTranslation();
  useKeyDownActions({ onCancel });

  const label = (kind: TranslationOutputKind) => (kind === 'mono' ? _('Chinese') : _('Bilingual'));

  return (
    <div className='fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4'>
      <div
        role='dialog'
        aria-modal='true'
        aria-label={_('Open Book')}
        className='modal-box bg-base-100 w-full max-w-sm rounded-2xl p-5'
      >
        <h2 className='text-lg font-semibold'>{_('Open Book')}</h2>
        <p className='text-base-content/70 mt-2 text-sm'>
          {book.title} · {_('This book has a translated copy.')}
        </p>
        {downloading && (
          <p className='text-base-content/70 mt-2 text-xs'>{_('Downloading translated PDF...')}</p>
        )}
        <div className='mt-5 flex flex-col gap-2'>
          <button
            type='button'
            className='btn btn-ghost eink-bordered justify-start'
            disabled={downloading}
            onClick={() => onChoose('original')}
          >
            {_('Open the original PDF')}
          </button>
          {translatedBook && (
            <button
              type='button'
              className='btn btn-contrast justify-start'
              disabled={downloading}
              onClick={() => onChoose('epub')}
            >
              {_('Open the Chinese EPUB')}
            </button>
          )}
          {kinds.map((kind) => (
            <button
              key={kind}
              type='button'
              className='btn btn-contrast justify-start'
              disabled={downloading}
              onClick={() => onChoose(kind)}
            >
              {label(kind)}
            </button>
          ))}
        </div>
        <div className='mt-4 flex justify-end'>
          <button type='button' className='btn btn-ghost btn-sm' onClick={onCancel}>
            {_('Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TranslationOpenDialog;
