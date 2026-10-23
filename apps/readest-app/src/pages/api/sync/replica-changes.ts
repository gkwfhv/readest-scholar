import type { NextApiRequest, NextApiResponse } from 'next';
import { validateChangePullParams, formatChangePage } from '@/libs/replicaChangeProtocol';
import type { ChangeRecord } from '@/libs/replicaChangeProtocol';
import { createSupabaseClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { runMiddleware, corsAllMethods } from '@/utils/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ code: 'VALIDATION', error: 'Method Not Allowed' });
  }
  if (!req.url) {
    return res.status(400).json({ code: 'VALIDATION', error: 'Invalid request URL' });
  }

  const { user, token } = await validateUserAndToken(req.headers.authorization ?? null);
  if (!user || !token) {
    return res.status(401).json({ code: 'AUTH', error: 'Not authenticated' });
  }

  const protocol = process.env['PROTOCOL'] || 'http';
  const host = process.env['HOST'] || 'localhost:3000';
  const url = new URL(req.url, protocol + '://' + host);
  const validation = validateChangePullParams(
    url.searchParams.get('kind'),
    url.searchParams.get('after'),
    url.searchParams.get('limit'),
  );
  if (!validation.ok) {
    return res.status(validation.status).json({ code: validation.code, error: validation.message });
  }

  const { kind, after, limit } = validation.params;
  const supabase = createSupabaseClient(token);
  const { data, error } = await supabase.rpc('replica_changes_page', {
    p_kind: kind,
    p_after: after,
    p_limit: limit + 1,
  });
  if (error) {
    console.error('pull replica changes failed', { kind, error });
    return res.status(500).json({ code: 'SERVER', error: 'Replica change pull failed' });
  }
  return res.status(200).json(formatChangePage((data ?? []) as ChangeRecord[], after, limit));
}
