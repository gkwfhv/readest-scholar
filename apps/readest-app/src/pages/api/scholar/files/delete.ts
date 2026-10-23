import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';
import { isSafeObjectKeyName } from '@/utils/object';

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { user, token } = await validateUserAndToken(req.headers.authorization);
  if (!user || !token) return res.status(403).json({ error: 'Not authenticated' });

  const { fileName, opId, expectedVersionId } = req.body ?? {};
  if (
    typeof fileName !== 'string' ||
    !isSafeObjectKeyName(fileName) ||
    !/^Readest\/Books\/[^/]+\/[^/]+$/.test(fileName) ||
    !isUuid(opId) ||
    !(expectedVersionId === null || isUuid(expectedVersionId))
  ) return res.status(400).json({ error: 'Invalid Scholar file delete request' });

  const { data, error } = await createSupabaseClient(token).rpc('delete_scholar_file_v1', {
    p_file_key: user.id + '/' + fileName,
    p_op_id: opId,
    p_expected_version_id: expectedVersionId,
  });
  if (error) {
    if (error.code === 'PT409') return res.status(409).json({ error: 'Scholar delete conflict; remote version retained' });
    if (error.code === 'PT410') return res.status(410).json({ error: 'Scholar file already deleted' });
    if (error.code === 'PT404' || error.code === '42501') {
      return res.status(404).json({ error: 'Scholar file not found' });
    }
    if (error.code === '22023') return res.status(400).json({ error: 'Invalid Scholar file delete request' });
    console.error('Scholar file delete failed:', error);
    return res.status(500).json({ error: 'Could not delete Scholar file' });
  }
  const result = data?.[0];
  if (!result?.file_id || !result.deleted_at) {
    return res.status(500).json({ error: 'Invalid Scholar delete response' });
  }
  return res.status(200).json({
    fileId: result.file_id,
    activeVersionId: result.active_version_id ?? null,
    deletedAt: result.deleted_at,
  });
}
