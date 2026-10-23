import type { NextApiRequest, NextApiResponse } from 'next';
import { validateUserAndToken } from '@/utils/access';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { createSupabaseAdminClient } from '@/utils/supabase';

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user, token } = await validateUserAndToken(req.headers.authorization);
  if (!user || !token) return res.status(403).json({ error: 'Not authenticated' });

  const { fileId, versionId, idempotencyKey, mode, glossarySha256 } = req.body ?? {};
  if (
    !isUuid(fileId) ||
    !isUuid(versionId) ||
    !isUuid(idempotencyKey) ||
    !['mono', 'dual', 'both'].includes(mode) ||
    (glossarySha256 !== undefined &&
      (typeof glossarySha256 !== 'string' || !/^[0-9a-f]{64}$/.test(glossarySha256)))
  ) {
    return res.status(400).json({ error: 'Invalid translation request' });
  }

  // The model endpoint and credentials are controlled by the server, never by a
  // document or an untrusted API body. This also prevents an arbitrary URL fetch.
  const model = process.env['SCHOLAR_TRANSLATION_MODEL']?.trim();
  if (!model || model.length > 120) {
    return res.status(503).json({ error: 'Translation model is unavailable' });
  }

  const supabase = createSupabaseAdminClient();
  const { data: job, error } = await supabase.rpc('enqueue_scholar_translation_job_v1', {
    p_user_id: user.id,
    p_source_file_id: fileId,
    p_source_version_id: versionId,
    p_idempotency_key: idempotencyKey,
    p_mode: mode,
    p_target_language: 'zh-CN',
    p_engine: 'openai-compatible',
    p_model: model,
    p_glossary_sha256: glossarySha256 ?? null,
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
