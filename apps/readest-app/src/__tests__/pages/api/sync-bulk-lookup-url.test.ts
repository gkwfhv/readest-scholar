import { describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const filters: string[] = [];
const fromMock = vi.fn((table: string) => {
  if (table !== 'books') throw new Error(`Unexpected table: ${table}`);
  return {
    select: () => ({
      or: async (filter: string) => {
        filters.push(filter);
        return encodeURIComponent(filter).length > 6000
          ? { data: null, error: { message: 'URI too long' } }
          : { data: [], error: null };
      },
    }),
    insert: (rows: unknown[]) => ({ select: async () => ({ data: rows, error: null }) }),
  };
});

vi.mock('@/utils/supabase', () => ({
  createSupabaseClient: () => ({ from: fromMock }),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: async () => ({
    user: { id: '00000000-0000-4000-8000-000000000001' },
    token: 'tok',
  }),
}));

import { POST } from '@/pages/api/sync';

describe('POST /api/sync bulk book push', () => {
  it('keeps every lookup URL bounded while accepting 201 books', async () => {
    filters.length = 0;
    const books = Array.from({ length: 201 }, (_, i) => ({
      hash: i.toString(16).padStart(64, '0'),
      title: `Scholar Paper ${i + 1}`,
      author: 'Synthetic Author',
      format: 'PDF',
    }));
    const response = await POST(
      new Request('https://web.readest.com/api/sync', {
        method: 'POST',
        headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
        body: JSON.stringify({ books }),
      }) as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    expect((await response.json()).books).toHaveLength(201);
    expect(filters.length).toBeGreaterThan(1);
    expect(Math.max(...filters.map((filter) => encodeURIComponent(filter).length))).toBeLessThan(
      6000,
    );
  });
});
