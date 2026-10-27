import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const state = vi.hoisted(() => ({
  userId: '00000000-0000-4000-8000-000000000001',
  rpc: vi.fn(),
}));
vi.mock('@/utils/cors', () => ({ corsAllMethods: {}, runMiddleware: vi.fn() }));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: vi.fn(async () => ({
    user: state.userId ? { id: state.userId } : null,
    token: state.userId ? 'synthetic-token' : null,
  })),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({ rpc: state.rpc }),
}));
import cancelHandler from '@/pages/api/scholar/translation-jobs/[id]/cancel';
import retryHandler from '@/pages/api/scholar/translation-jobs/[id]/retry';

const jobId = '00000000-0000-4000-8000-000000000005';
const retryId = '00000000-0000-4000-8000-000000000006';
async function call(handler: typeof cancelHandler, id = jobId, body: Record<string, unknown> = {}) {
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-token' },
    query: { id },
    body,
  } as unknown as NextApiRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as NextApiResponse;
  await handler(req, res);
  return res;
}
beforeEach(() => {
  state.userId = '00000000-0000-4000-8000-000000000001';
  state.rpc.mockReset().mockResolvedValue({
    data: { id: jobId, state: 'canceled', progress: 0 },
    error: null,
  });
});
describe('Scholar translation controls', () => {
  it('requests cancellation for only the authenticated owner', async () => {
    const res = await call(cancelHandler);
    expect(state.rpc).toHaveBeenCalledWith('cancel_scholar_translation_job_v1', {
      p_user_id: state.userId,
      p_job_id: jobId,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it('retries into a new job with a fresh idempotency key', async () => {
    const res = await call(retryHandler, jobId, { idempotencyKey: retryId });
    expect(state.rpc).toHaveBeenCalledWith('retry_scholar_translation_job_v3', {
      p_user_id: state.userId,
      p_job_id: jobId,
      p_idempotency_key: retryId,
    });
    expect(res.status).toHaveBeenCalledWith(202);
  });
  it('rejects unauthenticated cancellation', async () => {
    state.userId = '';
    const res = await call(cancelHandler);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('rejects malformed retry keys', async () => {
    const res = await call(retryHandler, jobId, { idempotencyKey: 'oops' });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
