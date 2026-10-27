import { describe, expect, it } from 'vitest';
import type { DBBookNote } from '@/types/records';
import { preserveLegacyPdfAnchor } from '@/pages/api/sync';

const anchor = {
  version: 1 as const,
  pageIndex: 1,
  cfi: 'epubcfi(/6/4!/4/2)',
  rects: [[0.1, 0.2, 0.4, 0.3] as [number, number, number, number]],
};
const note = (overrides: Partial<DBBookNote> = {}): DBBookNote => ({
  user_id: 'test-user',
  book_hash: 'pdf-hash',
  id: 'highlight-1',
  type: 'annotation',
  cfi: anchor.cfi,
  page: 2,
  note: 'research note',
  ...overrides,
});

describe('legacy PDF note synchronization', () => {
  it('keeps geometry when an older client edits the note at the same source', () => {
    const result = preserveLegacyPdfAnchor(note({ note: 'edited' }), note({ pdf_anchor: anchor }));
    expect(result.pdf_anchor).toEqual(anchor);
    expect(result.note).toBe('edited');
  });

  it('honors an explicit geometry clear from a new client', () => {
    expect(
      preserveLegacyPdfAnchor(note({ pdf_anchor: null }), note({ pdf_anchor: anchor })).pdf_anchor,
    ).toBeNull();
  });

  it('clears geometry when a legacy client moves the note or page', () => {
    const current = note({ pdf_anchor: anchor });
    expect(preserveLegacyPdfAnchor(note({ cfi: 'moved' }), current).pdf_anchor).toBeNull();
    expect(preserveLegacyPdfAnchor(note({ page: 3 }), current).pdf_anchor).toBeNull();
  });

  it('inserts an old note without geometry', () => {
    expect(preserveLegacyPdfAnchor(note()).pdf_anchor).toBeNull();
  });
});
