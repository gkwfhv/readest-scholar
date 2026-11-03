import { describe, expect, it } from 'vitest';

import {
  getTranslationBadge,
  pickFresherTranslation,
  selectTranslatableBooks,
} from '@/app/library/utils/libraryUtils';
import type { Book, BookTranslation } from '@/types/book';

const _ = (key: string) => key;

const book = (overrides: Partial<Book> = {}): Book => ({
  hash: 'h1',
  format: 'PDF',
  title: 'T',
  author: 'A',
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
});

const translation = (overrides: Partial<BookTranslation> = {}): BookTranslation => ({
  jobId: 'j1',
  state: 'queued',
  progress: 0,
  mode: 'dual',
  outputs: [],
  updatedAt: 1,
  ...overrides,
});

describe('getTranslationBadge', () => {
  it('is null for an untranslated book', () => {
    expect(getTranslationBadge(book(), _)).toBeNull();
  });

  it('shows a waiting mark while queued', () => {
    expect(getTranslationBadge(book({ translation: translation() }), _)).toEqual({
      text: '…',
      tone: 'busy',
      label: 'Waiting',
    });
  });

  it('shows a rounded, clamped percentage while running', () => {
    expect(
      getTranslationBadge(
        book({ translation: translation({ state: 'running', progress: 42.6 }) }),
        _,
      )?.text,
    ).toBe('43%');
    expect(
      getTranslationBadge(
        book({ translation: translation({ state: 'running', progress: 140 }) }),
        _,
      )?.text,
    ).toBe('100%');
  });

  it('shows a green 译 when succeeded', () => {
    expect(
      getTranslationBadge(
        book({ translation: translation({ state: 'succeeded', progress: 100 }) }),
        _,
      ),
    ).toEqual({ text: '译', tone: 'done', label: 'Translated' });
  });

  it('shows a red mark when failed or canceled', () => {
    for (const state of ['failed', 'canceled'] as const) {
      expect(getTranslationBadge(book({ translation: translation({ state }) }), _)?.tone).toBe(
        'failed',
      );
    }
  });
});

describe('selectTranslatableBooks', () => {
  const books = [
    book({ hash: 'a' }),
    book({ hash: 'b', format: 'EPUB' }),
    book({ hash: 'c', deletedAt: 1 }),
    book({ hash: 'd', format: 'PDF' }),
  ];

  it('keeps only live PDFs in the selection', () => {
    expect(selectTranslatableBooks(['a', 'b', 'c'], books, books).map((b) => b.hash)).toEqual([
      'a',
    ]);
  });

  it('ignores books outside the selection', () => {
    expect(selectTranslatableBooks(['a'], books, books).map((b) => b.hash)).toEqual(['a']);
  });
});

describe('pickFresherTranslation', () => {
  it('picks the newer timestamp and ties to the first side', () => {
    const older = { translation: translation({ jobId: 'old' }), translationUpdatedAt: 10 };
    const newer = { translation: translation({ jobId: 'new' }), translationUpdatedAt: 20 };
    expect(pickFresherTranslation(older, newer).translation?.jobId).toBe('new');
    expect(pickFresherTranslation(newer, older).translation?.jobId).toBe('new');
    expect(pickFresherTranslation(older, older).translation?.jobId).toBe('old');
  });

  it('treats a missing timestamp as epoch 0', () => {
    const stamped = { translation: translation({ jobId: 'stamped' }), translationUpdatedAt: 1 };
    const unstamped = { translation: translation({ jobId: 'unstamped' }) };
    expect(pickFresherTranslation(unstamped, stamped).translation?.jobId).toBe('stamped');
  });
});
