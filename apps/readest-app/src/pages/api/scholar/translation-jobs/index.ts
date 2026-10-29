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

const validPageSelection = (value: unknown): value is string => {
  if (
    typeof value !== 'string' ||
    value.length > 120 ||
    !/^[1-9][0-9]*(?:-[1-9][0-9]*)?(?:,[1-9][0-9]*(?:-[1-9][0-9]*)?)*$/.test(value)
  )
    return false;
  const seen = new Set<number>();
  for (const part of value.split(',')) {
    const bounds = part.split('-');
    const start = Number(bounds[0]);
    const end = Number(bounds[1] ?? bounds[0]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || end > 500)
      return false;
    for (let page = start; page <= end; page++) {
      if (seen.has(page)) return false;
      seen.add(page);
    }
  }
  return true;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'POST' && req.method !== 'GET')
    return res.status(405).json({ error: 'Method not allowed' });

  const { user, token } = await validateUserAndToken(req.headers.authorization);
  if (!user || !token) return res.status(403).json({ error: 'Not authenticated' });

  if (req.method === 'GET') {
    const fileId = req.query['fileId'];
    if (!isUuid(fileId)) return res.status(400).json({ error: 'Invalid file ID' });
    const supabase = createSupabaseAdminClient();
    const { data: jobs, error } = await supabase
      .from('scholar_translation_jobs')
      .select('id,state,progress,mode,error_code,created_at')
      .eq('user_id', user.id)
      .eq('source_file_id', fileId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) return res.status(500).json({ error: 'Could not list translation jobs' });
    return res.status(200).json({ jobs: jobs ?? [] });
  }

  const {
    fileId,
    versionId,
    idempotencyKey,
    mode,
    translationModel,
    glossarySha256,
    whiteBackgroundCompatibility,
    whiteBackgroundPages,
  } = req.body ?? {};
  if (
    !isUuid(fileId) ||
    !isUuid(versionId) ||
    !isUuid(idempotencyKey) ||
    !['mono', 'dual', 'both'].includes(mode) ||
    (whiteBackgroundCompatibility !== undefined &&
      typeof whiteBackgroundCompatibility !== 'boolean') ||
    (whiteBackgroundPages !== undefined &&
      (whiteBackgroundCompatibility !== true || !validPageSelection(whiteBackgroundPages))) ||
    (glossarySha256 !== undefined &&
      (typeof glossarySha256 !== 'string' || !/^[0-9a-f]{64}$/.test(glossarySha256)))
  ) {
    return res.status(400).json({ error: 'Invalid translation request' });
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

  const supabase = createSupabaseAdminClient();
  const { data: job, error } = await supabase.rpc('enqueue_scholar_translation_job_v4', {
    p_job_id: jobId,
    p_user_id: user.id,
    p_source_file_id: fileId,
    p_source_version_id: versionId,
    p_idempotency_key: idempotencyKey,
    p_mode: mode,
    p_target_language: 'zh-CN',
    p_engine: 'openai-compatible',
    p_model: modelConfig.model,
    p_model_provider: modelConfig.provider,
    p_model_config_fingerprint: translationModelFingerprint(modelConfig),
    p_model_config_nonce: sealed.nonce,
    p_model_config_ciphertext: sealed.ciphertext,
    p_model_config_auth_tag: sealed.authTag,
    p_glossary_sha256: glossarySha256 ?? null,
    p_white_background_compat: whiteBackgroundCompatibility ?? false,
    p_white_background_pages: whiteBackgroundPages ?? null,
  });
  if (error) {
    if (error.code === 'PT409') return res.status(409).json({ error: 'Idempotency key conflict' });
    if (error.code === 'PT413')
      return res.status(413).json({ error: 'PDF exceeds translation limit' });
    if (error.code === 'PT429') return res.status(429).json({ error: 'Translation queue is full' });
    if (error.code === '42501') return res.status(404).json({ error: 'Source PDF not found' });
    if (error.code === '22023')
      return res.status(400).json({ error: 'Invalid translation request' });
    console.error('Scholar translation enqueue failed:', error.code);
    return res.status(500).json({ error: 'Could not queue translation' });
  }
  if (!job?.id) return res.status(500).json({ error: 'Invalid translation job response' });

  return res.status(202).json({
    id: job.id,
    state: job.state,
    progress: job.progress,
    sourceFileId: job.source_file_id,
  });
}
