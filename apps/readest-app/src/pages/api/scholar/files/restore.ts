import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { user, token } = await validateUserAndToken(req.headers.authorization);
  if (!user || !token) return res.status(403).json({ error: 'Not authenticated' });

  const { fileId, versionId, expectedVersionId } = req.body ?? {};
  if (!isUuid(fileId) || !isUuid(versionId) || !isUuid(expectedVersionId)) {
    return res.status(400).json({ error: 'Invalid file restore request' });
  }

  const { data, error } = await createSupabaseClient(token).rpc('restore_scholar_file_version_v1', {
    p_file_id: fileId,
    p_version_id: versionId,
    p_expected_version_id: expectedVersionId,
  });
  if (error) {
    if (error.code === 'PT409') return res.status(409).json({ error: 'File changed since review' });
    if (error.code === '42501') return res.status(403).json({ error: 'Scholar file not found' });
    if (error.code === '22023') return res.status(404).json({ error: 'File version not found' });
    console.error('Scholar version restore failed:', error);
    return res.status(500).json({ error: 'Could not restore Scholar file version' });
  }
  if (!data || data.version_id !== versionId) {
    return res.status(500).json({ error: 'Invalid Scholar restore response' });
  }
  return res.status(200).json({ activeVersionId: data.version_id });
}
