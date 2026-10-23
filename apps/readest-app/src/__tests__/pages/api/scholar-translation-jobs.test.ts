import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const state = vi.hoisted(() => ({
  userId: '00000000-0000-4000-8000-000000000001',
  rpc: vi.fn(),
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
  createSupabaseAdminClient: () => ({ rpc: state.rpc, from: state.from }),
}));
import handler from '@/pages/api/scholar/translation-jobs';

const fileId = '00000000-0000-4000-8000-000000000002';
const versionId = '00000000-0000-4000-8000-000000000003';
const requestId = '00000000-0000-4000-8000-000000000004';
const jobId = '00000000-0000-4000-8000-000000000005';
function call(body: Record<string, unknown>) {
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
const valid = { fileId, versionId, idempotencyKey: requestId, mode: 'dual' };
beforeEach(() => {
  state.userId = '00000000-0000-4000-8000-000000000001';
  state.from.mockReset();
  state.rpc.mockReset().mockResolvedValue({
    data: { id: jobId, state: 'queued', progress: 0, source_file_id: fileId },
    error: null,
  });
  process.env['SCHOLAR_TRANSLATION_MODEL'] = 'local-model';
});
describe('Scholar translation enqueue API', () => {
  it('queues only under the authenticated account', async () => {
    const res = await call({ ...valid, userId: '00000000-0000-4000-8000-000000000099' });
    expect(state.rpc).toHaveBeenCalledWith(
      'enqueue_scholar_translation_job_v1',
      expect.objectContaining({ p_user_id: state.userId, p_source_file_id: fileId }),
    );
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: jobId, state: 'queued' }));
  });
  it('rejects unauthenticated requests before touching the queue', async () => {
    state.userId = '';
    const res = await call(valid);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('rejects invalid mode and identifiers', async () => {
    const res = await call({ ...valid, mode: 'free', versionId: '../../etc/passwd' });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('does not silently reuse an idempotency key with different input', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: 'PT409' } });
    const res = await call(valid);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('Scholar translation history API', () => {
  it('lists only jobs for the authenticated owner and source file', async () => {
    const rows = [{ id: jobId, state: 'succeeded', progress: 100, mode: 'dual' }];
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    state.from.mockReturnValue(query);
    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer synthetic-token' },
      query: { fileId },
    } as unknown as NextApiRequest;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as NextApiResponse;
    await handler(req, res);
    expect(query.eq).toHaveBeenCalledWith('user_id', state.userId);
    expect(query.eq).toHaveBeenCalledWith('source_file_id', fileId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ jobs: rows });
  });
});
