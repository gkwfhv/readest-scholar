import { randomUUID } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { validateUserAndToken } from '@/utils/access';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { readAiVaultKey, sealTranslationModelConfig } from '@/server/scholarAiVault';
import {
  normalizeTranslationModelConfig,
  translationModelFingerprint,
} from '@/server/scholarTranslationModel';

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user, token } = await validateUserAndToken(req.headers.authorization);
  if (!user || !token) return res.status(403).json({ error: 'Not authenticated' });

  const { id } = req.query;
  const { idempotencyKey, translationModel } = req.body ?? {};
  if (!isUuid(id) || !isUuid(idempotencyKey)) {
    return res.status(400).json({ error: 'Invalid translation retry request' });
  }
  const modelConfig = normalizeTranslationModelConfig(translationModel);
  if (!modelConfig) {
    return res.status(400).json({
      error:
        'Configure AI Assistant with AI Gateway or an OpenAI-compatible provider before translating',
    });
  }

  const jobId = randomUUID();
  let sealed;
  try {
    sealed = sealTranslationModelConfig(
      readAiVaultKey(),
      user.id,
      jobId,
      JSON.stringify(modelConfig),
    );
  } catch {
    return res.status(503).json({ error: 'Translation credential vault is unavailable' });
  }

  const { data: job, error } = await createSupabaseAdminClient().rpc(
    'retry_scholar_translation_job_v4',
    {
      p_job_id: jobId,
      p_user_id: user.id,
      p_prior_job_id: id,
      p_idempotency_key: idempotencyKey,
      p_model: modelConfig.model,
      p_model_provider: modelConfig.provider,
      p_model_config_fingerprint: translationModelFingerprint(modelConfig),
      p_model_config_nonce: sealed.nonce,
      p_model_config_ciphertext: sealed.ciphertext,
      p_model_config_auth_tag: sealed.authTag,
    },
  );
  if (error?.code === '42501') return res.status(404).json({ error: 'Translation job not found' });
  if (error?.code === 'PT409') return res.status(409).json({ error: 'Translation retry conflict' });
  if (error?.code === 'PT429') return res.status(429).json({ error: 'Translation queue is full' });
  if (error || !job?.id) return res.status(500).json({ error: 'Could not retry translation' });
  return res.status(202).json({ id: job.id, state: job.state, progress: job.progress });
}
