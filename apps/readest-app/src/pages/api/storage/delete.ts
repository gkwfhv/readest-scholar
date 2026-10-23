import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { deleteObject } from '@/utils/object';
import { isProtectedScholarStorageKey } from '@/utils/scholarProtectedFile';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user, token } = await validateUserAndToken(req.headers['authorization']);
    if (!user || !token) {
      return res.status(403).json({ error: 'Not authenticated' });
    }

    const { fileKey } = req.query;

    if (!fileKey || typeof fileKey !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid fileKey' });
    }

    if (fileKey.startsWith(`${user.id}/Scholar/versions/`)) {
      return res.status(400).json({ error: 'Protected file version' });
    }

    if (isProtectedScholarStorageKey(fileKey, user.id)) {
      return res.status(409).json({ error: 'Use Scholar version-aware file deletion' });
    }

    const supabase = createSupabaseAdminClient();
    const { data: fileRecord, error: fileError } = await supabase
      .from('files')
      .select('user_id, id')
      .eq('user_id', user.id)
      .eq('file_key', fileKey)
      .limit(1)
      .single();

    if (fileError || !fileRecord) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (fileRecord.user_id !== user.id) {
      return res.status(403).json({ error: 'Unauthorized access to the file' });
    }

    // Also protect an immutable version when this server has not enabled the
    // Scholar release flag. Never delete the object if a retained version
    // depends on this file row.
    const { data: version, error: versionError } = await supabase
      .from('scholar_file_versions')
      .select('file_id')
      .eq('user_id', user.id)
      .eq('file_id', fileRecord.id)
      .limit(1)
      .maybeSingle();
    if (versionError && !['42P01', 'PGRST205'].includes(versionError.code)) {
      return res.status(500).json({ error: 'Could not verify Scholar versions' });
    }
    if (version) return res.status(409).json({ error: 'Use Scholar version-aware file deletion' });

    try {
      await deleteObject(fileKey);
      const { error: deleteError } = await supabase.from('files').delete().eq('id', fileRecord.id);

      if (deleteError) {
        console.error('Error updating file record:', deleteError);
        return res.status(500).json({ error: 'Could not update file record' });
      }

      res.status(200).json({ message: 'File deleted successfully' });
    } catch (error) {
      console.error('Error deleting file from S3:', error);
      res.status(500).json({ error: 'Could not delete file from storage' });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
