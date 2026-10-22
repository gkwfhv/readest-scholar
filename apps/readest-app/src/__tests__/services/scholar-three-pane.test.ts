import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import {
  buildScholarCollectionTree,
  selectScholarCollectionBooks,
} from '@/services/scholar/threePane';

const makeBook = (index: number, groupName?: string): Book => ({
  hash: String(index),
  format: 'PDF',
  title: `Paper ${index}`,
  author: 'Researcher',
  groupName,
  createdAt: index,
  updatedAt: index,
});

describe('Scholar three-pane collection selection', () => {
  const books = [
    ...Array.from({ length: 100 }, (_, index) => makeBook(index, 'Research/Batch A')),
    ...Array.from({ length: 101 }, (_, index) => makeBook(index + 100, 'Research/Batch B')),
    makeBook(201, 'Research/Batch A2'),
    makeBook(202),
    { ...makeBook(203, 'Research/Batch A'), deletedAt: 1 },
  ];

  it('counts 200+ books at every ancestor and preserves empty nested collections', () => {
    expect(buildScholarCollectionTree(books, ['Research/Empty/Archive', 'Spare'])).toEqual([
      { path: 'Research', name: 'Research', depth: 0, count: 202 },
      { path: 'Research/Batch A', name: 'Batch A', depth: 1, count: 100 },
      { path: 'Research/Batch A2', name: 'Batch A2', depth: 1, count: 1 },
      { path: 'Research/Batch B', name: 'Batch B', depth: 1, count: 101 },
      { path: 'Research/Empty', name: 'Empty', depth: 1, count: 0 },
      { path: 'Research/Empty/Archive', name: 'Archive', depth: 2, count: 0 },
      { path: 'Spare', name: 'Spare', depth: 0, count: 0 },
    ]);
  });

  it('selects a collection and its descendants without matching similarly prefixed siblings', () => {
    expect(selectScholarCollectionBooks(books, 'Research/Batch A')).toHaveLength(100);
    expect(selectScholarCollectionBooks(books, 'Research')).toHaveLength(202);
    expect(selectScholarCollectionBooks(books, 'Research/Empty')).toEqual([]);
    expect(selectScholarCollectionBooks(books, null)).toHaveLength(203);
  });
});
