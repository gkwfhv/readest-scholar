import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';
import { isSafeObjectKeyName } from '@/utils/object';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { user, token } = await validateUserAndToken(req.headers.authorization);
  if (!user || !token) return res.status(403).json({ error: 'Not authenticated' });

  const { fileKey } = req.query;
  const prefix = `${user.id}/Readest/Books/`;
  if (typeof fileKey !== 'string') {
    return res.status(400).json({ error: 'Invalid file key' });
  }
  if (!fileKey.startsWith(prefix)) {
    return res.status(404).json({ error: 'Scholar file not found' });
  }
  if (!isSafeObjectKeyName(fileKey.slice(user.id.length + 1))) {
    return res.status(400).json({ error: 'Invalid file key' });
  }

  const supabase = createSupabaseAdminClient();
  const { data: file, error: fileError } = await supabase
    .from('files')
    .select('id')
    .eq('user_id', user.id)
    .eq('file_key', fileKey)
    .is('deleted_at', null)
    .maybeSingle();
  if (fileError) return res.status(500).json({ error: 'Could not read Scholar file' });
  if (!file) return res.status(404).json({ error: 'Scholar file not found' });

  const { data: linked, error: linkError } = await supabase
    .from('scholar_document_files')
    .select('file_id')
    .eq('user_id', user.id)
    .eq('file_id', file.id)
    .maybeSingle();
  if (linkError) return res.status(500).json({ error: 'Could not read Scholar document' });
  if (!linked) return res.status(404).json({ error: 'Scholar file not found' });

  const { data: head, error: headError } = await supabase
    .from('scholar_file_heads')
    .select('version_id')
    .eq('user_id', user.id)
    .eq('file_id', file.id)
    .maybeSingle();
  if (headError) return res.status(500).json({ error: 'Could not read Scholar version' });
  return res.status(200).json({ fileId: file.id, activeVersionId: head?.version_id ?? null });
}
