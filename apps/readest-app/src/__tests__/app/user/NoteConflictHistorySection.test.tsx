import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  list: vi.fn(),
  current: vi.fn(),
  restore: vi.fn(),
  rpc: vi.fn(),
}));
const owner = '00000000-0000-4000-8000-000000000001';
const currentNote = {
  user_id: owner,
  book_hash: 'paper-hash',
  id: 'note-1',
  type: 'annotation',
  page: 5,
  note: 'current text',
  updated_at: '2026-10-23T00:00:00Z',
  deleted_at: null,
};
const history = {
  user_id: owner,
  book_hash: 'paper-hash',
  note_id: 'note-1',
  source: 'incoming',
  version_hash: 'a'.repeat(32),
  recorded_at: '2026-10-23T00:01:00Z',
  row_data: { ...currentNote, note: 'older text' },
};
vi.mock('@/utils/supabase', () => ({
  createSupabaseClient: () => ({
    from: (table: string) =>
      table === 'book_note_conflict_versions'
        ? { select: () => ({ eq: () => ({ order: () => ({ limit: state.list }) }) }) }
        : {
            select: () => ({
              eq: () => ({ eq: () => ({ eq: () => ({ single: state.current }) }) }),
            }),
          },
    rpc: (...args: unknown[]) => {
      state.rpc(...args);
      return { single: state.restore };
    },
  }),
}));
vi.mock('@/hooks/useTranslation', () => {
  const translate = (key: string) => key;
  return { useTranslation: () => translate };
});

import { NoteConflictHistorySection } from '@/app/user/components/NoteConflictHistorySection';

beforeEach(() => {
  state.list.mockResolvedValue({
    data: [history, { ...history, user_id: 'other-account' }],
    error: null,
  });
  state.current.mockResolvedValue({ data: currentNote, error: null });
  state.restore.mockResolvedValue({ data: { ...currentNote, note: 'older text' }, error: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('NoteConflictHistorySection', () => {
  it('shows only this account, checks the current row, and restores with compare-and-swap', async () => {
    render(<NoteConflictHistorySection userId={owner} token='synthetic-token' />);
    expect(await screen.findByText('older text')).toBeTruthy();
    expect(screen.getAllByText('older text')).toHaveLength(1);
    const restore = screen.getByRole('button', { name: 'Restore this note' });
    expect(restore.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByText('older text'));
    await waitFor(() => expect(state.current).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(restore.hasAttribute('disabled')).toBe(false));
    fireEvent.click(restore);
    await waitFor(() => expect(state.restore).toHaveBeenCalledTimes(1));
    expect(state.rpc).toHaveBeenCalledWith(
      'restore_book_note_version_v1',
      expect.objectContaining({
        p_user_id: owner,
        p_book_hash: 'paper-hash',
        p_note_id: 'note-1',
        p_expected_current: currentNote,
      }),
    );
    expect(screen.getByText('Note version restored on the server.')).toBeTruthy();
  });

  it('ignores an old failed load after a newer account request succeeds', async () => {
    let finishOld: (value: { data: null; error: { message: string } }) => void = () => {};
    const old = new Promise<{ data: null; error: { message: string } }>((resolve) => {
      finishOld = resolve;
    });
    state.list.mockImplementationOnce(() => old);
    const { rerender } = render(<NoteConflictHistorySection userId={owner} token='old-token' />);
    rerender(<NoteConflictHistorySection userId={owner} token='new-token' />);
    expect(await screen.findByText('older text')).toBeTruthy();
    await act(async () => finishOld({ data: null, error: { message: 'offline' } }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('older text')).toBeTruthy();
  });

  it('shows a conflict when another edit wins before restoration', async () => {
    state.restore.mockResolvedValue({ data: null, error: { code: 'PT409' } });
    render(<NoteConflictHistorySection userId={owner} token='synthetic-token' />);
    const restore = await screen.findByRole('button', { name: 'Restore this note' });
    fireEvent.click(screen.getByText('older text'));
    await waitFor(() => expect(restore.hasAttribute('disabled')).toBe(false));
    fireEvent.click(restore);
    expect(
      await screen.findByText('This note changed on another device. Refresh before restoring it.'),
    ).toBeTruthy();
  });
});
