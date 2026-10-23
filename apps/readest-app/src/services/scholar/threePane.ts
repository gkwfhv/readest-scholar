import type { Book } from '@/types/book';

export interface ScholarCollectionRow {
  path: string;
  name: string;
  depth: number;
  count: number;
}

const collectionParts = (path: string): string[] =>
  path
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);

const collectionAncestors = (path: string): string[] => {
  const parts = collectionParts(path);
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
};

const collectionOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const buildScholarCollectionTree = (
  books: readonly Book[],
  emptyPaths: readonly string[] = [],
): ScholarCollectionRow[] => {
  const counts = new Map<string, number>();
  for (const path of emptyPaths) {
    for (const ancestor of collectionAncestors(path))
      counts.set(ancestor, counts.get(ancestor) ?? 0);
  }
  for (const book of books) {
    if (book.deletedAt || !book.groupName) continue;
    for (const ancestor of collectionAncestors(book.groupName)) {
      counts.set(ancestor, (counts.get(ancestor) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(([a], [b]) => {
      const left = a.split('/');
      const right = b.split('/');
      for (let index = 0; index < Math.min(left.length, right.length); index++) {
        const compared = collectionOrder.compare(left[index]!, right[index]!);
        if (compared !== 0) return compared;
      }
      return left.length - right.length;
    })
    .map(([path, count]) => {
      const parts = path.split('/');
      return { path, name: parts.at(-1)!, depth: parts.length - 1, count };
    });
};

export const selectScholarCollectionBooks = (books: readonly Book[], path: string | null): Book[] =>
  books.filter(
    (book) =>
      !book.deletedAt &&
      (!path || book.groupName === path || book.groupName?.startsWith(`${path}/`)),
  );
