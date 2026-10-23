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
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid translation job ID' });

  const { data: job, error } = await createSupabaseAdminClient().rpc(
    'cancel_scholar_translation_job_v1',
    { p_user_id: user.id, p_job_id: id },
  );
  if (error?.code === '42501') return res.status(404).json({ error: 'Translation job not found' });
  if (error || !job?.id) return res.status(500).json({ error: 'Could not cancel translation' });
  return res.status(200).json({
    id: job.id,
    state: job.state,
    cancelRequested: job.cancel_requested,
  });
}
