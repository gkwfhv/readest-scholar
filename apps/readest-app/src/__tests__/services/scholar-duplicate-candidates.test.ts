import { describe, expect, it } from 'vitest';

import type { BookMetadata } from '@/libs/document';
import type { Book } from '@/types/book';
import { findPossibleScholarDuplicate } from '@/services/scholar/duplicateCandidates';

const book = (hash: string, metadata: Partial<BookMetadata>, deletedAt?: number): Book =>
  ({
    hash,
    title: metadata.title || 'Untitled',
    author: metadata.author || 'Unknown',
    format: 'PDF',
    metadata,
    deletedAt,
  }) as Book;

describe('scholarly duplicate suggestions', () => {
  it('matches normalized DOI before a weaker title match', () => {
    const books = [
      book('title-only', {
        title: 'A Research Paper',
        author: 'Ada Researcher',
        published: '2024',
      }),
      book('doi-match', { title: 'Revised paper', doi: 'https://doi.org/10.1000/ABC.1' }),
    ];

    expect(
      findPossibleScholarDuplicate(
        {
          title: 'A Research Paper',
          author: 'Ada Researcher',
          language: 'en',
          published: '2024',
          doi: 'doi:10.1000/abc.1',
        },
        'editing',
        books,
      ),
    ).toEqual({ book: books[1], reason: 'doi' });
  });

  it('suggests matching title, author and year when DOI is unavailable', () => {
    const existing = book('existing', {
      title: '  Deep   Learning for Science ',
      author: 'Ada Researcher',
      published: '2024-05-12',
    });
    expect(
      findPossibleScholarDuplicate(
        {
          title: 'deep learning for science',
          author: 'ada researcher',
          language: 'en',
          published: '2024',
        },
        'incoming',
        [existing],
      ),
    ).toEqual({ book: existing, reason: 'metadata' });
  });

  it('ignores the edited book, deleted books and conflicting years or DOIs', () => {
    const current = book('current', { title: 'Deep Learning', doi: '10.1000/one' });
    const deleted = book('deleted', { title: 'Deep Learning', doi: '10.1000/one' }, 123);
    const otherYear = book('other-year', {
      title: 'Deep Learning',
      author: 'Ada Researcher',
      published: '2023',
    });
    const otherDoi = book('other-doi', {
      title: 'Deep Learning',
      author: 'Ada Researcher',
      published: '2024',
      doi: '10.1000/two',
    });

    expect(
      findPossibleScholarDuplicate(
        {
          title: 'Deep Learning',
          author: 'Ada Researcher',
          language: 'en',
          published: '2024',
          doi: '10.1000/one',
        },
        'current',
        [current, deleted, otherYear, otherDoi],
      ),
    ).toBeNull();
  });
});
