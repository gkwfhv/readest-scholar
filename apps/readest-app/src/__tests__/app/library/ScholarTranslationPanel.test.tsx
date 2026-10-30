import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ScholarTranslationPanel from '@/app/library/components/ScholarTranslationPanel';
import type { Book } from '@/types/book';

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
  getScholarAccountId: vi.fn(async () => 'acct-1'),
  dispatch: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/services/scholarFileBaseline', () => ({
  getScholarAccountId: () => mocks.getScholarAccountId(),
}));

vi.mock('@/utils/fetch', () => ({
  fetchWithAuth: (url: unknown, init?: unknown) => mocks.fetchWithAuth(url, init),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: (name: string, payload?: unknown) => mocks.dispatch(name, payload),
  },
}));

vi.mock('@/services/environment', () => ({
  getAPIBaseUrl: () => 'http://test.local',
}));

const book = {
  hash: 'hash-1',
  format: 'PDF',
  title: 'Paper',
  sourceTitle: 'Paper',
} as Book;

describe('ScholarTranslationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchWithAuth.mockImplementation(async (url: unknown) => ({
      json: async () =>
        String(url).includes('/scholar/files/status')
          ? { fileId: 'f1', activeVersionId: 'v1' }
          : { jobs: [] },
    }));
  });

  afterEach(cleanup);

  it('renders an aligned two-column grid with full-width output and glossary controls', async () => {
    render(<ScholarTranslationPanel book={book} />);

    const select = (await screen.findByLabelText('Output')) as HTMLSelectElement;
    expect(select.className).toContain('w-full');
    expect(select.className).not.toContain('w-28');

    const glossaryLabel = screen.getByText('Glossary CSV');
    expect(glossaryLabel.tagName).toBe('LABEL');
    expect(glossaryLabel.getAttribute('for')).toBe('scholar-translation-glossary');

    const fileInput = screen.getByLabelText('Glossary CSV') as HTMLInputElement;
    expect(fileInput.type).toBe('file');
    expect(fileInput.className).toContain('w-full');
    expect(fileInput.className).not.toContain('max-w-48');
    expect(fileInput.className).not.toContain('whitespace-nowrap');

    const grid = fileInput.closest('div.grid');
    expect(grid).toBeTruthy();
    expect(grid!.className).toContain('grid-cols-[auto_1fr]');
  });
});
