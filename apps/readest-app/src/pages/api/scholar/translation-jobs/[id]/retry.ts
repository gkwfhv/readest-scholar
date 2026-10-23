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

  const { id } = req.query;
  const { idempotencyKey } = req.body ?? {};
  if (!isUuid(id) || !isUuid(idempotencyKey)) {
    return res.status(400).json({ error: 'Invalid translation retry request' });
  }

  const { data: job, error } = await createSupabaseAdminClient().rpc(
    'retry_scholar_translation_job_v1',
    { p_user_id: user.id, p_job_id: id, p_idempotency_key: idempotencyKey },
  );
  if (error?.code === '42501') return res.status(404).json({ error: 'Translation job not found' });
  if (error?.code === 'PT409') return res.status(409).json({ error: 'Translation retry conflict' });
  if (error?.code === 'PT429') return res.status(429).json({ error: 'Translation queue is full' });
  if (error || !job?.id) return res.status(500).json({ error: 'Could not retry translation' });
  return res.status(202).json({ id: job.id, state: job.state, progress: job.progress });
}
