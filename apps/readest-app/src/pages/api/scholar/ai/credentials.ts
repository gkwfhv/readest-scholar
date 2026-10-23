import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import {
  openAiCredential,
  readAiVaultKey,
  sealAiCredential,
  type ScholarAiCredentialKind,
  type SealedAiCredential,
} from '@/server/scholarAiVault';

const KINDS: readonly ScholarAiCredentialKind[] = ['aiGatewayApiKey', 'openrouterApiKey'];
function isKind(value: unknown): value is ScholarAiCredentialKind {
  return typeof value === 'string' && KINDS.includes(value as ScholarAiCredentialKind);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { user, token } = await validateUserAndToken(req.headers.authorization);
  if (!user || !token) return res.status(403).json({ error: 'Not authenticated' });

  if (req.method === 'PUT') {
    const { kind, value } = req.body ?? {};
    if (!isKind(kind) || typeof value !== 'string' || value.length > 4096 || value.includes('\0')) {
      return res.status(400).json({ error: 'Invalid AI credential' });
    }
  }

  let key: Buffer;
  try {
    key = readAiVaultKey();
  } catch {
    return res.status(503).json({ error: 'AI credential vault is unavailable' });
  }

  const db = createSupabaseAdminClient().from('scholar_ai_credentials');
  if (req.method === 'GET') {
    const { data, error } = await db
      .select('kind,nonce,ciphertext,auth_tag')
      .eq('user_id', user.id);
    if (error) return res.status(500).json({ error: 'Could not read AI credentials' });
    const credentials: Partial<Record<ScholarAiCredentialKind, string>> = {};
    try {
      for (const row of data ?? []) {
        if (!isKind(row.kind)) throw new Error('Invalid AI credential kind');
        const envelope: SealedAiCredential = {
          nonce: row.nonce,
          ciphertext: row.ciphertext,
          authTag: row.auth_tag,
        };
        credentials[row.kind] = openAiCredential(key, user.id, row.kind, envelope);
      }
    } catch {
      return res.status(500).json({ error: 'Could not decrypt AI credentials' });
    }
    return res.status(200).json(credentials);
  }

  const { kind, value } = req.body as { kind: ScholarAiCredentialKind; value: string };
  if (!value) {
    const { error } = await db.delete().eq('user_id', user.id).eq('kind', kind);
    return error
      ? res.status(500).json({ error: 'Could not clear AI credential' })
      : res.status(200).json({ saved: true });
  }
  const sealed = sealAiCredential(key, user.id, kind, value);
  const { error } = await db.upsert(
    {
      user_id: user.id,
      kind,
      nonce: sealed.nonce,
      ciphertext: sealed.ciphertext,
      auth_tag: sealed.authTag,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,kind' },
  );
  return error
    ? res.status(500).json({ error: 'Could not save AI credential' })
    : res.status(200).json({ saved: true });
}
