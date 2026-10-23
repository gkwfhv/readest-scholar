import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import {
  getStoragePlanData,
  STORAGE_QUOTA_GRACE_BYTES,
  validateUserAndToken,
} from '@/utils/access';
import { getUploadSignedUrl } from '@/utils/object';

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user, token } = await validateUserAndToken(req.headers.authorization);
  if (!user || !token) return res.status(403).json({ error: 'Not authenticated' });

  const { fileId, opId, sha256, fileSize } = req.body ?? {};
  if (
    !isUuid(fileId) ||
    !isUuid(opId) ||
    typeof sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(sha256) ||
    !Number.isSafeInteger(fileSize) ||
    fileSize < 0
  ) {
    return res.status(400).json({ error: 'Invalid file reservation' });
  }

  const { quota } = getStoragePlanData(token);
  const quotaBytes = quota + STORAGE_QUOTA_GRACE_BYTES;
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 0) {
    return res.status(500).json({ error: 'Invalid storage entitlement' });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc('reserve_scholar_file_version_v1', {
    p_user_id: user.id,
    p_file_id: fileId,
    p_op_id: opId,
    p_sha256: sha256,
    p_file_size: fileSize,
    p_quota_bytes: quotaBytes,
  });
  if (error) {
    if (error.code === 'PT413')
      return res.status(413).json({ error: 'Insufficient storage quota' });
    if (error.code === 'PT410') return res.status(410).json({ error: 'Reservation expired' });
    if (error.code === '42501') return res.status(403).json({ error: 'File not owned by account' });
    if (error.code === '22023') return res.status(400).json({ error: 'Invalid file reservation' });
    console.error('Scholar reservation failed:', error);
    return res.status(500).json({ error: 'Could not reserve file version' });
  }

  const reservation = Array.isArray(data) ? data[0] : undefined;
  if (!reservation?.version_id || !reservation?.object_key) {
    return res.status(500).json({ error: 'Invalid reservation response' });
  }
  if (reservation.state === 'ready') {
    return res.status(200).json({ versionId: reservation.version_id, state: 'ready' });
  }
  if (reservation.state !== 'pending') {
    return res.status(410).json({ error: 'Reservation expired' });
  }

  try {
    const uploadUrl = await getUploadSignedUrl(
      reservation.object_key,
      fileSize,
      300,
      undefined,
      true,
    );
    return res.status(200).json({
      versionId: reservation.version_id,
      state: 'pending',
      expiresAt: reservation.expires_at,
      uploadUrl,
      headers: { 'If-None-Match': '*' },
    });
  } catch (signError) {
    console.error('Scholar upload signing failed:', signError);
    return res.status(500).json({ error: 'Could not sign file version upload' });
  }
}
