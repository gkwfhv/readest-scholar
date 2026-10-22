import { cleanup, render, screen } from '@testing-library/react';
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

const list = vi.fn(async () => ({ data, error: null }));
vi.mock('@/utils/supabase', () => ({
  createSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ limit: list }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/services/sync/replicaSync', () => ({
  getReplicaSync: () => null,
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
  test('shows account recovery versions without exposing protected values', async () => {
    render(<SyncConflictHistorySection userId='account-a' token='synthetic-token' />);
    expect(await screen.findByText('Recoverable sync versions')).toBeTruthy();
    expect(await screen.findByText('dark')).toBeTruthy();
    expect(screen.getByText('Protected value')).toBeTruthy();
    expect(screen.queryByText('private-token')).toBeNull();
    expect(list).toHaveBeenCalled();
  });
});
