'use client';

import React, { useState } from 'react';

import type { Book, TranslationMode } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import {
  describeTranslationError,
  resolveTranslationModel,
  type TranslationOptions,
} from '@/services/scholarTranslation';

interface TranslationOptionsDialogProps {
  /** One book for the context menu, N for a batch — one form for all of them. */
  books: Book[];
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (options: TranslationOptions) => void;
}

/**
 * Translation options collected before a single or batch job starts. The
 * output form / glossary / white-background controls mirror the details-panel
 * editor so the two surfaces never drift; the model is read-only because it
 * comes from AI Assistant settings and the server has no prompt override.
 */
const TranslationOptionsDialog: React.FC<TranslationOptionsDialogProps> = ({
  books,
  busy = false,
  error,
  onCancel,
  onSubmit,
}) => {
  const _ = useTranslation();
  const [documentType, setDocumentType] = useState<'auto' | 'paper' | 'book'>('auto');
  const [mode, setMode] = useState<TranslationMode>('dual');
  const [glossary, setGlossary] = useState<File | null>(null);
  const [whiteBackground, setWhiteBackground] = useState(false);
  const [whiteBackgroundPages, setWhiteBackgroundPages] = useState('');
  const [localError, setLocalError] = useState('');

  useKeyDownActions({ onCancel });

  const model = resolveTranslationModel();
  const batch = books.length > 1;
  const isBook = documentType === 'book';

  const submit = () => {
    if (busy) return;
    if (!model) {
      setLocalError(describeTranslationError('no-model', _));
      return;
    }
    if (!isBook && whiteBackground && !whiteBackgroundPages.trim()) {
      setLocalError(_('Enter the compatibility page numbers.'));
      return;
    }
    setLocalError('');
    onSubmit({
      mode: isBook ? 'mono' : mode,
      documentType,
      glossaryCsv: glossary,
      whiteBackgroundCompatibility: isBook ? false : whiteBackground,
      whiteBackgroundPages: !isBook && whiteBackground ? whiteBackgroundPages.trim() : undefined,
    });
  };

  return (
    <div className='fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4'>
      <div
        role='dialog'
        aria-modal='true'
        aria-label={_('PDF translation')}
        className='modal-box bg-base-100 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl p-5'
      >
        <h2 className='text-lg font-semibold'>{_('PDF translation')}</h2>
        <p className='text-base-content/70 mt-1 text-sm'>
          {batch
            ? _('{{count}} PDF(s) will be translated with the same options.', {
                count: books.length,
              })
            : _('Create a translated copy while keeping the original PDF')}
        </p>

        <div className='mt-4 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3'>
          <label className='text-xs' htmlFor='translation-options-document-type'>
            {_('Document type')}
          </label>
          <select
            id='translation-options-document-type'
            className='select select-bordered select-sm eink-bordered w-full'
            value={documentType}
            disabled={busy}
            onChange={(event) => setDocumentType(event.target.value as 'auto' | 'paper' | 'book')}
          >
            <option value='auto'>{_('Auto')}</option>
            <option value='paper'>{_('Paper (in-place PDF)')}</option>
            <option value='book' disabled={batch}>
              {_('Book (Chinese EPUB)')}
            </option>
          </select>

          {!isBook && (
            <>
              <label className='text-xs' htmlFor='translation-options-mode'>
                {_('Output')}
              </label>
              <select
                id='translation-options-mode'
                className='select select-bordered select-sm eink-bordered w-full'
                value={mode}
                disabled={busy}
                onChange={(event) => setMode(event.target.value as TranslationMode)}
              >
                <option value='dual'>{_('Bilingual')}</option>
                <option value='mono'>{_('Chinese')}</option>
                <option value='both'>{_('Both')}</option>
              </select>
            </>
          )}

          <label className='text-xs' htmlFor='translation-options-glossary'>
            {_('Glossary CSV')}
          </label>
          <input
            id='translation-options-glossary'
            className='file-input file-input-bordered file-input-xs eink-bordered w-full'
            type='file'
            accept='.csv,text/csv'
            disabled={busy}
            onChange={(event) => setGlossary(event.target.files?.[0] ?? null)}
          />

          <span className='text-xs'>{_('Translation model')}</span>
          <span className='text-base-content/70 truncate text-xs'>
            {model ? `${model.provider} · ${model.model}` : describeTranslationError('no-model', _)}
          </span>
        </div>

        {isBook && (
          <p className='text-base-content/65 mt-4 text-xs'>
            {_(
              'Book mode generates a Chinese EPUB with chapter structure, keeps reference sections in English, and does not preserve complex table or formula layouts.',
            )}
          </p>
        )}

        {!isBook && (
          <label className='eink-bordered border-base-300 mt-4 flex w-full items-start gap-2 rounded-md border p-2 text-xs'>
            <input
              type='checkbox'
              className='checkbox checkbox-xs eink-bordered mt-0.5'
              checked={whiteBackground}
              disabled={busy}
              onChange={(event) => setWhiteBackground(event.target.checked)}
            />
            <span>
              <span className='font-medium'>{_('White-background compatibility')}</span>
              <span className='text-base-content/65 mt-1 block'>
                {_('Use on white pages when original text overlaps the translation.')}
              </span>
            </span>
          </label>
        )}

        {!isBook && whiteBackground && (
          <label className='mt-2 block w-full text-xs'>
            {_('Compatibility pages')}
            <input
              type='text'
              className='input input-bordered input-sm eink-bordered mt-1 block w-full'
              value={whiteBackgroundPages}
              maxLength={120}
              placeholder='2,4-6'
              disabled={busy}
              onChange={(event) => setWhiteBackgroundPages(event.target.value)}
            />
            <span className='text-base-content/65 mt-1 block'>
              {_('Select text-only pages; cleanup can cover labels inside figures.')}
            </span>
          </label>
        )}

        {(localError || error) && (
          <p role='alert' className='text-error mt-3 text-sm'>
            {localError || error}
          </p>
        )}

        <div className='mt-5 flex justify-end gap-2'>
          <button
            type='button'
            className='btn btn-ghost eink-bordered'
            disabled={busy}
            onClick={onCancel}
          >
            {_('Cancel')}
          </button>
          <button
            type='button'
            className='btn btn-contrast'
            disabled={busy || !model}
            onClick={submit}
          >
            {_('Translate')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TranslationOptionsDialog;
