import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const state = vi.hoisted(() => ({
  userId: '00000000-0000-4000-8000-000000000001',
  from: vi.fn(),
}));
vi.mock('@/utils/cors', () => ({ corsAllMethods: {}, runMiddleware: vi.fn() }));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: vi.fn(async () => ({
    user: state.userId ? { id: state.userId } : null,
    token: state.userId ? 'synthetic-token' : null,
  })),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({ from: state.from }),
}));
import handler from '@/pages/api/scholar/translation-glossaries';

function call(body: unknown) {
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-token' },
    body,
  } as unknown as NextApiRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as NextApiResponse;
  return handler(req, res).then(() => res);
}

beforeEach(() => {
  state.userId = '00000000-0000-4000-8000-000000000001';
  state.from.mockReset();
});
describe('Scholar glossary upload', () => {
  it('binds the content hash and owner on insert', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    state.from.mockReturnValue({ insert });
    const csv = 'source,target,tgt_lng\nBERT,双向编码器,zh-CN\n';
    const res = await call({ csv, userId: '00000000-0000-4000-8000-000000000099' });
    expect(state.from).toHaveBeenCalledWith('scholar_translation_glossaries');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: state.userId, csv_text: csv }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });
  it('rejects untrusted oversized input before storage', async () => {
    const res = await call({ csv: 'source,target,tgt_lng\n' + 'x'.repeat(65536) });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(state.from).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated upload before storage', async () => {
    state.userId = '';
    const res = await call({ csv: 'source,target,tgt_lng\nBERT,foo,zh-CN\n' });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(state.from).not.toHaveBeenCalled();
  });
});
