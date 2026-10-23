import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';
import { getObjectDigest } from '@/utils/objectDigest';

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user, token } = await validateUserAndToken(req.headers.authorization);
  if (!user || !token) return res.status(403).json({ error: 'Not authenticated' });

  const { fileId, opId, expectedVersionId } = req.body ?? {};
  if (
    !isUuid(fileId) ||
    !isUuid(opId) ||
    (expectedVersionId !== null && !isUuid(expectedVersionId))
  ) {
    return res.status(400).json({ error: 'Invalid file completion' });
  }

  const supabase = createSupabaseAdminClient();
  const { data: version, error: lookupError } = await supabase
    .from('scholar_file_versions')
    .select('object_key,sha256,file_size,version_id')
    .eq('user_id', user.id)
    .eq('file_id', fileId)
    .eq('op_id', opId)
    .single();
  if (lookupError || !version) {
    if (lookupError?.code === 'PGRST116') {
      return res.status(404).json({ error: 'File version not found' });
    }
    console.error('Scholar version lookup failed:', lookupError);
    return res.status(500).json({ error: 'Could not read file version' });
  }

  let verified: { sha256: string; size: number };
  try {
    verified = await getObjectDigest(version.object_key);
  } catch {
    return res.status(409).json({ error: 'Upload incomplete' });
  }
  if (verified.sha256 !== version.sha256 || verified.size !== version.file_size) {
    return res.status(409).json({ error: 'Uploaded bytes differ from reservation' });
  }

  const { data, error } = await supabase.rpc('complete_scholar_file_version_v1', {
    p_user_id: user.id,
    p_file_id: fileId,
    p_op_id: opId,
    p_verified_sha256: verified.sha256,
    p_verified_size: verified.size,
    p_expected_version_id: expectedVersionId,
  });
  if (error) {
    if (error.code === 'PT410') return res.status(410).json({ error: 'Reservation expired' });
    if (error.code === '23514')
      return res.status(409).json({ error: 'Uploaded bytes differ from reservation' });
    if (error.code === '22023') return res.status(404).json({ error: 'File version not found' });
    console.error('Scholar completion failed:', error);
    return res.status(500).json({ error: 'Could not complete file version' });
  }
  const result = Array.isArray(data) ? data[0] : undefined;
  if (!result) return res.status(500).json({ error: 'Invalid completion response' });
  return res.status(result.applied ? 200 : 409).json({
    versionId: version.version_id,
    applied: result.applied,
    activeVersionId: result.active_version_id,
  });
}
