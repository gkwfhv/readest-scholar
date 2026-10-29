import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import { randomBytes } from 'node:crypto';

const state = vi.hoisted(() => ({
  tokenValid: true,
  row: null as Record<string, string> | null,
  from: vi.fn(),
  key: Buffer.alloc(32, 3),
}));
vi.mock('@/server/scholarTranslationWorkerToken', () => ({
  isValidTranslationWorkerToken: () => state.tokenValid,
}));
vi.mock('@/server/scholarAiVault', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/scholarAiVault')>()),
  readAiVaultKey: () => state.key,
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: state.from,
  }),
}));

import handler from '@/pages/api/internal/scholar/translation-model/[id]';
import { sealTranslationModelConfig } from '@/server/scholarAiVault';

const userId = '00000000-0000-4000-8000-000000000001';
const jobId = '00000000-0000-4000-8000-000000000002';
const leaseToken = '00000000-0000-4000-8000-000000000003';

function call() {
  const req = {
    method: 'GET',
    query: { id: jobId },
    headers: {
      'x-scholar-translation-worker-token': 'synthetic-worker-token',
      'x-scholar-translation-lease-token': leaseToken,
    },
  } as unknown as NextApiRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  } as unknown as NextApiResponse;
  return handler(req, res).then(() => res);
}

beforeEach(() => {
  state.tokenValid = true;
  state.key = randomBytes(32);
  const sealed = sealTranslationModelConfig(
    state.key,
    userId,
    jobId,
    JSON.stringify({
      provider: 'openrouter',
      baseUrl: 'https://models.example.test/v1',
      model: 'provider/model',
      apiKey: 'synthetic-api-key',
    }),
  );
  state.row = {
    id: jobId,
    user_id: userId,
    model: 'provider/model',
    model_config_nonce: sealed.nonce,
    model_config_ciphertext: sealed.ciphertext,
    model_config_auth_tag: sealed.authTag,
  };
  state.from.mockReset().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: state.row, error: null }),
  });
});

describe('leased translation model endpoint', () => {
  it('returns a profile only for an authenticated internal worker with a current lease', async () => {
    const res = await call();
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openrouter',
      baseUrl: 'https://models.example.test/v1',
      model: 'provider/model',
      apiKey: 'synthetic-api-key',
    });
  });

  it('does not query or disclose a profile without the worker token', async () => {
    state.tokenValid = false;
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(state.from).not.toHaveBeenCalled();
  });

  it('fails closed when no matching live lease exists', async () => {
    state.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
