import type { NextApiRequest, NextApiResponse } from 'next';
import {
  openTranslationModelConfig,
  readAiVaultKey,
  type SealedAiCredential,
} from '@/server/scholarAiVault';
import { normalizeTranslationModelConfig } from '@/server/scholarTranslationModel';
import { isValidTranslationWorkerToken } from '@/server/scholarTranslationWorkerToken';
import { createSupabaseAdminClient } from '@/utils/supabase';

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function header(req: NextApiRequest, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Docker-internal endpoint. A worker can retrieve one encrypted profile only
 * while it holds that job's unexpired lease; public callers never receive an
 * oracle for model credentials.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isValidTranslationWorkerToken(header(req, 'x-scholar-translation-worker-token'))) {
    return res.status(404).json({ error: 'Not found' });
  }

  const { id } = req.query;
  const leaseToken = header(req, 'x-scholar-translation-lease-token');
  if (!isUuid(id) || !isUuid(leaseToken))
    return res.status(400).json({ error: 'Invalid job lease' });

  const { data: job, error } = await createSupabaseAdminClient()
    .from('scholar_translation_jobs')
    .select('id,user_id,model,model_config_nonce,model_config_ciphertext,model_config_auth_tag')
    .eq('id', id)
    .eq('state', 'running')
    .eq('lease_token', leaseToken)
    .gt('lease_until', new Date().toISOString())
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'Could not read translation job' });
  if (!job?.model_config_nonce || !job.model_config_ciphertext || !job.model_config_auth_tag) {
    return res.status(404).json({ error: 'Translation model is unavailable' });
  }

  try {
    const envelope: SealedAiCredential = {
      nonce: job.model_config_nonce,
      ciphertext: job.model_config_ciphertext,
      authTag: job.model_config_auth_tag,
    };
    const config = normalizeTranslationModelConfig(
      JSON.parse(openTranslationModelConfig(readAiVaultKey(), job.user_id, job.id, envelope)),
    );
    if (!config || config.model !== job.model) throw new Error('Invalid translation model');
    return res.status(200).json(config);
  } catch {
    return res.status(500).json({ error: 'Translation model is unavailable' });
  }
}
