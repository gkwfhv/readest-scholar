import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ lookups: 0, upserts: [] as unknown[][] }));
const serverNote = {
  user_id: '00000000-0000-4000-8000-000000000001',
  book_hash: 'note-clock-test',
  id: 'note-1',
  type: 'annotation',
  note: 'newer server edit',
  created_at: new Date(1000).toISOString(),
  updated_at: new Date(3000).toISOString(),
  deleted_at: null,
};
vi.mock('@/utils/supabase', () => ({
  createSupabaseClient: () => ({
    from: (table: string) => {
      if (table !== 'book_notes') throw new Error(`Unexpected table: ${table}`);
      return {
        select: () => ({
          or: async () => {
            state.lookups++;
            return { data: [serverNote], error: null };
          },
        }),
        upsert: (rows: unknown[]) => {
          state.upserts.push(rows);
          return { data: [], error: null };
        },
      };
    },
  }),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: async () => ({
    user: { id: '00000000-0000-4000-8000-000000000001' },
    token: 'tok',
  }),
}));

import { POST } from '@/pages/api/sync';

describe('POST /api/sync note conflict', () => {
  beforeEach(() => {
    state.lookups = 0;
    state.upserts.length = 0;
  });

  it('sends a stale deletion through the database guard and returns the authoritative row', async () => {
    const response = await POST(
      new Request('https://web.readest.com/api/sync', {
        method: 'POST',
        headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
        body: JSON.stringify({
          notes: [
            {
              bookHash: 'note-clock-test',
              id: 'note-1',
              type: 'annotation',
              note: 'stale deletion',
              createdAt: 1000,
              updatedAt: 1000,
              deletedAt: 2000,
            },
          ],
        }),
      }) as unknown as NextRequest,
    );
    expect(response.status).toBe(200);
    expect(state.upserts).toHaveLength(1);
    expect(state.lookups).toBe(2);
    expect((await response.json()).notes).toEqual([serverNote]);
  });
});
