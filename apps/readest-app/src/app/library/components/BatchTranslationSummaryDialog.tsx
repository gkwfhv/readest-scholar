'use client';

import React from 'react';

import type { Book } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import {
  describeTranslationError,
  type TranslationFailureReason,
} from '@/services/scholarTranslation';

export interface BatchTranslationOutcome {
  book: Book;
  status: 'started' | 'skipped' | 'failed';
  reason?: TranslationFailureReason;
  /** Raw server/client message, shown after the mapped reason. */
  message?: string;
}

interface BatchTranslationSummaryDialogProps {
  outcomes: BatchTranslationOutcome[];
  onClose: () => void;
}

/** Batch result: one row per selected book, so a single failure never hides the
 *  books that did start. */
const BatchTranslationSummaryDialog: React.FC<BatchTranslationSummaryDialogProps> = ({
  outcomes,
  onClose,
}) => {
  const _ = useTranslation();
  useKeyDownActions({ onCancel: onClose });

  const started = outcomes.filter((outcome) => outcome.status === 'started').length;
  const notStarted = outcomes.length - started;

  return (
    <div className='fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4'>
      <div
        role='dialog'
        aria-modal='true'
        aria-label={_('Translation summary')}
        className='modal-box bg-base-100 w-full max-w-md rounded-2xl p-5'
      >
        <h2 className='text-lg font-semibold'>{_('Translation summary')}</h2>
        <p className='text-base-content/70 mt-1 text-sm'>
          {_('{{started}} started, {{failed}} skipped or failed', {
            started,
            failed: notStarted,
          })}
        </p>
        <ul className='mt-3 max-h-[50vh] overflow-y-auto text-sm'>
          {outcomes.map(({ book, status, reason, message }) => (
            <li key={book.hash} className='border-base-200 flex gap-2 border-b py-2 last:border-0'>
              <span className='min-w-0 flex-1 truncate' title={book.title}>
                {book.title}
              </span>
              <span
                className={
                  status === 'started' ? 'text-success shrink-0' : 'text-base-content/60 shrink-0'
                }
              >
                {status === 'started'
                  ? _('Started')
                  : `${describeTranslationError(reason ?? 'server-error', _)}${
                      message ? ` · ${message}` : ''
                    }`}
              </span>
            </li>
          ))}
        </ul>
        <div className='mt-4 flex justify-end'>
          <button type='button' className='btn btn-contrast' onClick={onClose}>
            {_('Close')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BatchTranslationSummaryDialog;
