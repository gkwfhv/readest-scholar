import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

const data = [
  {
    user_id: 'account-a',
    kind: 'settings',
    replica_id: 'singleton',
    source: 'incoming',
    version_hash: 'a'.repeat(32),
    recorded_at: '2026-10-23T00:00:00Z',
    row_data: {
      fields_jsonb: {
        theme: { v: 'dark', t: '0000000000100-00000000-a', s: 'a' },
        'readwise.accessToken': { v: 'private-token', t: '0000000000100-00000000-a', s: 'a' },
      },
    },
  },
];

const list = vi.fn(
  async (): Promise<{ data: typeof data | null; error: { message: string } | null }> => ({
    data,
    error: null,
  }),
);
const fetchReplica = vi.fn(async () => ({
  data: {
    user_id: 'account-a',
    kind: 'settings',
    replica_id: 'singleton',
    fields_jsonb: { theme: { v: 'light', t: '0000000000200-00000000-b', s: 'b' } },
    manifest_jsonb: null,
    deleted_at_ts: null,
    reincarnation: null,
  },
  error: null,
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseClient: () => ({
    from: (table: string) =>
      table === 'replicas'
        ? {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({ single: fetchReplica }),
                }),
              }),
            }),
          }
        : {
            select: () => ({
              eq: () => ({
                order: () => ({ limit: list }),
              }),
            }),
          },
  }),
}));
vi.mock('@/services/sync/replicaSync', () => ({
  getReplicaSync: () => ({ hlc: {} }),
  subscribeReplicaSyncReady: () => () => {},
}));
vi.mock('@/hooks/useTranslation', () => {
  const translate = (key: string) => key;
  return { useTranslation: () => translate };
});

import { SyncConflictHistorySection } from '@/app/user/components/SyncConflictHistorySection';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SyncConflictHistorySection', () => {
  test('ignores a stale failed history request after the replacement loads', async () => {
    let finishOld: (value: { data: null; error: { message: string } }) => void = () => {};
    const old = new Promise<{ data: null; error: { message: string } }>((resolve) => {
      finishOld = resolve;
    });
    list.mockImplementationOnce(() => old);
    const { rerender } = render(
      <SyncConflictHistorySection userId='account-a' token='old-token' />,
    );
    rerender(<SyncConflictHistorySection userId='account-a' token='new-token' />);
    expect(await screen.findByText('dark')).toBeTruthy();
    await act(async () => finishOld({ data: null, error: { message: 'offline' } }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('dark')).toBeTruthy();
  });

  test('shows account recovery versions without exposing protected values', async () => {
    render(<SyncConflictHistorySection userId='account-a' token='synthetic-token' />);
    expect(await screen.findByText('Recoverable sync versions')).toBeTruthy();
    expect(await screen.findByText('dark')).toBeTruthy();
    expect(screen.getByText('Protected value')).toBeTruthy();
    expect(screen.queryByText('private-token')).toBeNull();
    expect(list).toHaveBeenCalled();
    const restore = screen.getByRole('button', { name: 'Restore this field' });
    expect(restore.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByText('App settings'));
    await waitFor(() => expect(fetchReplica).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(restore.hasAttribute('disabled')).toBe(false));
  });
});
