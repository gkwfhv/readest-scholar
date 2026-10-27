import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';

const state = vi.hoisted(() => ({ calls: [] as { url: string; body?: string }[] }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (value: string) => value }));
vi.mock('@/services/environment', () => ({ getAPIBaseUrl: () => '/api' }));
vi.mock('@/services/scholarFileBaseline', () => ({
  getScholarAccountId: async () => '00000000-0000-4000-8000-000000000001',
}));
vi.mock('@/utils/book', () => ({ getRemoteBookFilename: () => 'paper.pdf' }));
vi.mock('@/utils/fetch', () => ({
  fetchWithAuth: vi.fn(async (url: string, options?: { method?: string; body?: string }) => {
    state.calls.push({ url, body: options?.body });
    let data: unknown;
    if (url.includes('/scholar/files/status')) {
      data = {
        fileId: '00000000-0000-4000-8000-000000000002',
        activeVersionId: '00000000-0000-4000-8000-000000000003',
      };
    } else if (options?.method === 'POST') {
      data = { id: '00000000-0000-4000-8000-000000000004', state: 'queued', progress: 0 };
    } else if (url.includes('/scholar/translation-jobs?')) {
      data = { jobs: [] };
    } else {
      data = {
        id: '00000000-0000-4000-8000-000000000004',
        state: 'queued',
        progress: 0,
        mode: 'dual',
      };
    }
    return { json: async () => data };
  }),
}));

import ScholarTranslationPanel from '@/app/library/components/ScholarTranslationPanel';

afterEach(() => {
  state.calls.length = 0;
});

it('only sends white-background compatibility when the reader selects it', async () => {
  const book = { hash: 'paper', title: 'Paper', format: 'PDF' } as Book;
  render(<ScholarTranslationPanel book={book} />);
  const translate = await screen.findByRole('button', { name: 'Translate' });
  fireEvent.click(screen.getByRole('checkbox', { name: /White-background compatibility/ }));
  fireEvent.change(screen.getByRole('textbox', { name: /Compatibility pages/ }), {
    target: { value: '2' },
  });
  fireEvent.click(translate);
  await waitFor(() => {
    const post = state.calls.find(
      (call) => call.url === '/api/scholar/translation-jobs' && call.body,
    );
    expect(post).toBeTruthy();
    expect(JSON.parse(post!.body!).whiteBackgroundCompatibility).toBe(true);
    expect(JSON.parse(post!.body!).whiteBackgroundPages).toBe('2');
  });
});
