import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { user, token } = await validateUserAndToken(req.headers.authorization);
  if (!user || !token) return res.status(403).json({ error: 'Not authenticated' });

  const { fileId, opId, versionId } = req.query;
  if (!isUuid(fileId) || (opId !== undefined && !isUuid(opId)) ||
      (versionId !== undefined && !isUuid(versionId)) ||
      (opId !== undefined && versionId !== undefined)) {
    return res.status(400).json({ error: 'Invalid file history request' });
  }

  const supabase = createSupabaseAdminClient();
  const { data: file, error: fileError } = await supabase
    .from('files')
    .select('id')
    .eq('user_id', user.id)
    .eq('id', fileId)
    .is('deleted_at', null)
    .maybeSingle();
  if (fileError) return res.status(500).json({ error: 'Could not read Scholar file' });
  if (!file) return res.status(404).json({ error: 'Scholar file not found' });

  const { data: linked, error: linkError } = await supabase
    .from('scholar_document_files')
    .select('file_id')
    .eq('user_id', user.id)
    .eq('file_id', fileId)
    .maybeSingle();
  if (linkError) return res.status(500).json({ error: 'Could not read Scholar document' });
  if (!linked) return res.status(404).json({ error: 'Scholar file not found' });

  const { data: head, error: headError } = await supabase
    .from('scholar_file_heads')
    .select('version_id')
    .eq('user_id', user.id)
    .eq('file_id', fileId)
    .maybeSingle();
  if (headError) return res.status(500).json({ error: 'Could not read Scholar version' });

  let query = supabase
    .from('scholar_file_versions')
    .select('version_id,op_id,sha256,file_size,verified_at')
    .eq('user_id', user.id)
    .eq('file_id', fileId)
    .eq('state', 'ready');
  if (opId) query = query.eq('op_id', opId);
  if (versionId) query = query.eq('version_id', versionId);
  const { data: versions, error: versionError } = await query
    .order('verified_at', { ascending: false })
    .limit(opId || versionId ? 1 : 100);
  if (versionError) return res.status(500).json({ error: 'Could not read Scholar version history' });

  return res.status(200).json({
    fileId,
    activeVersionId: head?.version_id ?? null,
    versions: (versions ?? []).map((version) => ({
      versionId: version.version_id,
      opId: version.op_id,
      sha256: version.sha256,
      fileSize: version.file_size,
      verifiedAt: version.verified_at,
    })),
  });
}
