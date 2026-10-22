import type { BookMetadata } from '@/libs/document';
import type { Book } from '@/types/book';
import { formatAuthors, formatTitle } from '@/utils/book';

export interface ScholarDuplicateCandidate {
  book: Book;
  reason: 'doi' | 'metadata';
}

const normalizeDoi = (value?: string) =>
  value
    ?.trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim()
    .toLowerCase() || '';

const normalizeText = (value: string) =>
  value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const yearOf = (value?: string) => value?.match(/^\s*(\d{4})/)?.[1] || '';

/** Suggest a likely match without merging files, identities, notes or annotations. */
export function findPossibleScholarDuplicate(
  metadata: BookMetadata,
  currentHash: string,
  books: readonly Book[],
): ScholarDuplicateCandidate | null {
  const others = books.filter((book) => book.hash !== currentHash && !book.deletedAt);
  const doi = normalizeDoi(metadata.doi);
  if (doi) {
    const match = others.find((book) => normalizeDoi(book.metadata?.doi) === doi);
    if (match) return { book: match, reason: 'doi' };
  }

  const title = normalizeText(formatTitle(metadata.title));
  const author = normalizeText(formatAuthors(metadata.author));
  const year = yearOf(metadata.published);
  if (title.length < 8 || !author || !year) return null;

  const match = others.find((book) => {
    const candidateDoi = normalizeDoi(book.metadata?.doi);
    if (doi && candidateDoi && doi !== candidateDoi) return false;
    return (
      normalizeText(formatTitle(book.metadata?.title || book.title)) === title &&
      normalizeText(formatAuthors(book.metadata?.author || book.author)) === author &&
      yearOf(book.metadata?.published) === year
    );
  });
  return match ? { book: match, reason: 'metadata' } : null;
}
