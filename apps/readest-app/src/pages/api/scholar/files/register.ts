import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';
import { isSafeObjectKeyName } from '@/utils/object';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user, token } = await validateUserAndToken(req.headers.authorization);
  if (!user || !token) return res.status(403).json({ error: 'Not authenticated' });

  const { fileName, bookHash } = req.body ?? {};
  if (
    typeof fileName !== 'string' ||
    typeof bookHash !== 'string' ||
    !isSafeObjectKeyName(fileName) ||
    !isSafeObjectKeyName(bookHash) ||
    bookHash.includes('/') ||
    !fileName.startsWith(`Readest/Books/${bookHash}/`) ||
    fileName.split('/').length !== 4
  ) {
    return res.status(400).json({ error: 'Invalid Scholar book file' });
  }

  const { data, error } = await createSupabaseAdminClient().rpc('register_scholar_file_v1', {
    p_user_id: user.id,
    p_file_key: `${user.id}/${fileName}`,
    p_book_hash: bookHash,
  });
  if (error) {
    if (error.code === 'PT404') {
      return res.status(409).json({ error: 'Book metadata must sync before its file' });
    }
    if (error.code === 'PT409') {
      return res.status(409).json({ error: 'File is not a linked Scholar book file' });
    }
    if (error.code === 'PT410') return res.status(410).json({ error: 'File is deleted' });
    if (error.code === '22023') return res.status(400).json({ error: 'Invalid Scholar book file' });
    console.error('Scholar file registration failed:', error);
    return res.status(500).json({ error: 'Could not register Scholar file' });
  }
  const row = data?.[0];
  if (!row?.file_id) return res.status(500).json({ error: 'Empty Scholar registration' });
  return res.status(200).json({
    fileId: row.file_id,
    activeVersionId: row.active_version_id ?? null,
  });
}
