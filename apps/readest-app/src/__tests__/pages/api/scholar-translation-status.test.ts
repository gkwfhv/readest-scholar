import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const state = vi.hoisted(() => ({
  userId: '00000000-0000-4000-8000-000000000001',
  from: vi.fn(),
  sign: vi.fn(),
  eqCalls: [] as [string, string][],
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
vi.mock('@/utils/object', () => ({
  getDownloadSignedUrl: (...args: unknown[]) => state.sign(...args),
}));
import handler from '@/pages/api/scholar/translation-jobs/[id]';

const jobId = '00000000-0000-4000-8000-000000000005';
function query(data: unknown) {
  const q: Record<string, unknown> = {};
  q['select'] = () => q;
  q['eq'] = vi.fn().mockImplementation((field: string, value: string) => {
    state.eqCalls.push([field, value]);
    return q;
  });
  q['maybeSingle'] = vi.fn().mockResolvedValue({ data, error: null });
  q['then'] = (resolve: (value: unknown) => void) => resolve({ data, error: null });
  return q;
}
async function call(id: string) {
  const req = {
    method: 'GET',
    headers: { authorization: 'Bearer synthetic-token' },
    query: { id },
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
  state.from.mockReset();
  state.eqCalls.length = 0;
  state.sign.mockReset().mockResolvedValue('http://127.0.0.1:9130/signed-pdf');
});
describe('Scholar translation job status', () => {
  it('reads an owned job and signs only its finished output', async () => {
    const job = { id: jobId, user_id: state.userId, state: 'succeeded', progress: 100 };
    const outputs = [
      {
        kind: 'dual',
        object_key: `${state.userId}/Scholar/translations/test.pdf`,
        sha256: 'a'.repeat(64),
        file_size: 123,
        page_count: 2,
      },
    ];
    state.from.mockImplementation((table: string) =>
      query(table === 'scholar_translation_jobs' ? job : outputs),
    );
    const res = await call(jobId);
    expect(state.from).toHaveBeenCalledWith('scholar_translation_jobs');
    expect(state.eqCalls.filter(([field]) => field === 'user_id')).toEqual([
      ['user_id', state.userId],
      ['user_id', state.userId],
    ]);
    expect(state.sign).toHaveBeenCalledWith(outputs[0]!.object_key, 300);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        id: jobId,
        outputs: [
          expect.objectContaining({
            kind: 'dual',
            downloadUrl: 'http://127.0.0.1:9130/signed-pdf',
          }),
        ],
      }),
    );
  });
  it('returns 404 instead of revealing an unowned job', async () => {
    state.from.mockImplementation(() => query(null));
    const res = await call(jobId);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(state.sign).not.toHaveBeenCalled();
  });
  it('rejects a guessed non-UUID path before querying', async () => {
    const res = await call('../other');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(state.from).not.toHaveBeenCalled();
  });
});
