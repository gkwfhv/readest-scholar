import type { NextApiRequest, NextApiResponse } from 'next';
import { validateUserAndToken } from '@/utils/access';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { getDownloadSignedUrl } from '@/utils/object';
import { createSupabaseAdminClient } from '@/utils/supabase';

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { user, token } = await validateUserAndToken(req.headers.authorization);
  if (!user || !token) return res.status(403).json({ error: 'Not authenticated' });

  const { id } = req.query;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid translation job ID' });

  const supabase = createSupabaseAdminClient();
  const { data: job, error } = await supabase
    .from('scholar_translation_jobs')
    .select(
      'id,state,progress,source_file_id,source_version_id,mode,target_language,error_code,created_at,updated_at,finished_at',
    )
    .eq('user_id', user.id)
    .eq('id', id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'Could not read translation job' });
  if (!job) return res.status(404).json({ error: 'Translation job not found' });

  let outputs: {
    kind: string;
    fileId: string;
    sha256: string;
    fileSize: number;
    pageCount: number;
    downloadUrl: string;
  }[] = [];
  if (job.state === 'succeeded') {
    const { data: rows, error: outputsError } = await supabase
      .from('scholar_translation_outputs')
      .select('kind,file_id,object_key,sha256,file_size,page_count')
      .eq('user_id', user.id)
      .eq('job_id', id);
    if (outputsError || !rows) {
      return res.status(500).json({ error: 'Could not read translated PDF' });
    }
    if (rows.some((row) => !row.object_key.startsWith(`${user.id}/Scholar/translations/`))) {
      return res.status(500).json({ error: 'Invalid translated PDF object' });
    }
    try {
      outputs = await Promise.all(
        rows.map(async (row) => ({
          kind: row.kind,
          fileId: row.file_id,
          sha256: row.sha256,
          fileSize: row.file_size,
          pageCount: row.page_count,
          downloadUrl: await getDownloadSignedUrl(row.object_key, 300),
        })),
      );
    } catch {
      return res.status(500).json({ error: 'Could not sign translated PDF' });
    }
  }

  return res.status(200).json({
    id: job.id,
    state: job.state,
    progress: job.progress,
    sourceFileId: job.source_file_id,
    sourceVersionId: job.source_version_id,
    mode: job.mode,
    targetLanguage: job.target_language,
    errorCode: job.error_code,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    finishedAt: job.finished_at,
    outputs,
  });
}
