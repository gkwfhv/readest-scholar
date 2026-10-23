import { createHash } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { validateUserAndToken } from '@/utils/access';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { createSupabaseAdminClient } from '@/utils/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'POST' && req.method !== 'GET')
    return res.status(405).json({ error: 'Method not allowed' });
  const { user, token } = await validateUserAndToken(req.headers.authorization);
  if (!user || !token) return res.status(403).json({ error: 'Not authenticated' });

  const supabase = createSupabaseAdminClient();
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('scholar_translation_glossaries')
      .select('sha256,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: 'Could not list glossaries' });
    return res.status(200).json({ glossaries: data ?? [] });
  }

  const csv = req.body?.csv;
  if (
    typeof csv !== 'string' ||
    Buffer.byteLength(csv, 'utf8') > 65536 ||
    Buffer.byteLength(csv, 'utf8') < 22 ||
    !csv.startsWith('source,target,tgt_lng\n') ||
    csv.includes('\0') ||
    csv.split('\n').length > 502
  ) {
    return res.status(400).json({ error: 'Invalid glossary CSV' });
  }
  const sha256 = createHash('sha256').update(csv, 'utf8').digest('hex');
  const { error } = await supabase.from('scholar_translation_glossaries').insert({
    user_id: user.id,
    sha256,
    csv_text: csv,
  });
  if (error && error.code !== '23505') {
    console.error('Scholar glossary upload failed:', error.code);
    return res.status(500).json({ error: 'Could not save glossary' });
  }
  return res.status(201).json({ sha256 });
}
