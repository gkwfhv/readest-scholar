import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';
import { getDownloadSignedUrl } from '@/utils/object';

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { user, token } = await validateUserAndToken(req.headers.authorization);
  if (!user || !token) return res.status(403).json({ error: 'Not authenticated' });

  const { fileId, versionId } = req.query;
  if (!isUuid(fileId) || (versionId !== undefined && !isUuid(versionId))) {
    return res.status(400).json({ error: 'Invalid file version request' });
  }

  const supabase = createSupabaseAdminClient();
  let selectedVersionId = versionId;
  if (!selectedVersionId) {
    const { data: head, error: headError } = await supabase
      .from('scholar_file_heads')
      .select('version_id')
      .eq('user_id', user.id)
      .eq('file_id', fileId)
      .single();
    if (headError || !head) {
      if (headError?.code === 'PGRST116')
        return res.status(404).json({ error: 'File version not found' });
      console.error('Scholar file head lookup failed:', headError);
      return res.status(500).json({ error: 'Could not read file version' });
    }
    selectedVersionId = head.version_id;
  }

  const { data: version, error: versionError } = await supabase
    .from('scholar_file_versions')
    .select('version_id,object_key,sha256,file_size')
    .eq('user_id', user.id)
    .eq('file_id', fileId)
    .eq('version_id', selectedVersionId)
    .eq('state', 'ready')
    .single();
  if (versionError || !version) {
    if (versionError?.code === 'PGRST116') {
      return res.status(404).json({ error: 'File version not found' });
    }
    console.error('Scholar file version lookup failed:', versionError);
    return res.status(500).json({ error: 'Could not read file version' });
  }

  try {
    const downloadUrl = await getDownloadSignedUrl(version.object_key, 300);
    return res.status(200).json({
      versionId: version.version_id,
      downloadUrl,
      sha256: version.sha256,
      fileSize: version.file_size,
    });
  } catch (error) {
    console.error('Scholar version download signing failed:', error);
    return res.status(500).json({ error: 'Could not sign file version download' });
  }
}
