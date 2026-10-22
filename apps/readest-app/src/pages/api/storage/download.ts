import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { getDownloadSignedUrl } from '@/utils/object';
import { validateUserAndToken } from '@/utils/access';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user, token } = await validateUserAndToken(req.headers['authorization']);
    if (!user || !token) {
      return res.status(403).json({ error: 'Not authenticated' });
    }

    if (req.method === 'GET') {
      let { fileKey } = req.query;
      // Also parse fileKey directly from raw URL to handle special characters like & in filenames.
      // because frameworks may incorrectly split parameters when the fileKey value contains
      // encoded & (%26), treating it as a parameter separator.
      if (req.url?.includes('fileKey=') && req.url?.includes('&')) {
        const fileKeyFromUrl = req.url
          .substring(req.url.indexOf('fileKey=') + 8)
          .replace(/\+/g, '%20')
          .replace(/&/g, '%26')
          .replace(/=$/, '');
        fileKey = decodeURIComponent(fileKeyFromUrl);
      }
      if (!fileKey || typeof fileKey !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid fileKey' });
      }

      const downloadUrlsMap = await processFileKeys([fileKey], user.id);
      const downloadUrl = downloadUrlsMap[fileKey];

      if (!downloadUrl) {
        return res.status(404).json({ error: 'File not found' });
      }

      return res.status(200).json({ downloadUrl });
    }

    if (req.method === 'POST') {
      const { fileKeys } = req.body;

      if (!fileKeys || !Array.isArray(fileKeys)) {
        return res.status(400).json({ error: 'Missing or invalid fileKeys array' });
      }

      if (fileKeys.length === 0) {
        return res.status(400).json({ error: 'fileKeys array cannot be empty' });
      }

      if (!fileKeys.every((key) => typeof key === 'string')) {
        return res.status(400).json({ error: 'All fileKeys must be strings' });
      }

      const downloadUrls = await processFileKeys(fileKeys, user.id);

      return res.status(200).json({ downloadUrls });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}

export async function processFileKeys(
  fileKeys: string[],
  userId: string,
): Promise<Record<string, string | undefined>> {
  const supabase = createSupabaseAdminClient();

  // PostgREST puts .in() filters in the URL even when this API receives a
  // POST body. The proxy rejected 50 real file paths (about 7 KB), so bound
  // both the number of values and their encoded length before making requests.
  const queryBatches = (values: string[]): string[][] => {
    const batches: string[][] = [];
    let batch: string[] = [];
    let encodedLength = 0;
    for (const value of values) {
      const itemLength = encodeURIComponent(`"${value}"`).length + (batch.length ? 3 : 0);
      if (batch.length && (batch.length >= 25 || encodedLength + itemLength > 2800)) {
        batches.push(batch);
        batch = [];
        encodedLength = 0;
      }
      batch.push(value);
      encodedLength += itemLength;
    }
    if (batch.length) batches.push(batch);
    return batches;
  };
  const fileQueryResults = await Promise.all(
    queryBatches(fileKeys).map((batch) =>
      supabase
        .from('files')
        .select('id, user_id, file_key, book_hash')
        .eq('user_id', userId)
        .in('file_key', batch)
        .is('deleted_at', null),
    ),
  );

  const fileError = fileQueryResults.find((result) => result.error)?.error;
  if (fileError) {
    console.error('Error querying files:', fileError);
    return Object.fromEntries(fileKeys.map((key) => [key, undefined]));
  }

  const fileRecordMap = new Map(
    fileQueryResults
      .flatMap((result) => result.data || [])
      .map((record) => [record.file_key, record]),
  );

  const missingFileKeys = fileKeys.filter((key) => !fileRecordMap.has(key));

  if (missingFileKeys.length > 0) {
    const fallbackCandidates = missingFileKeys
      .filter((key) => key.includes('Readest/Book'))
      .map((key) => {
        const parts = key.split('/');
        if (parts.length === 5) {
          const bookHash = parts[3]!;
          const filename = parts[4]!;
          const fileExtension = filename.split('.').pop() || '';
          return { originalKey: key, bookHash, fileExtension };
        }
        return null;
      })
      .filter(Boolean) as Array<{ originalKey: string; bookHash: string; fileExtension: string }>;

    if (fallbackCandidates.length > 0) {
      const bookHashes = [...new Set(fallbackCandidates.map((c) => c.bookHash))];

      const fallbackQueryResults = await Promise.all(
        queryBatches(bookHashes).map((batch) =>
          supabase
            .from('files')
            .select('id, user_id, file_key, book_hash')
            .eq('user_id', userId)
            .in('book_hash', batch)
            .is('deleted_at', null),
        ),
      );
      const fallbackRecords = fallbackQueryResults.flatMap((result) =>
        result.error ? [] : result.data || [],
      );

      if (fallbackRecords.length > 0) {
        for (const candidate of fallbackCandidates) {
          const matchedFile = fallbackRecords.find(
            (f) =>
              f.book_hash === candidate.bookHash &&
              f.file_key.endsWith(`.${candidate.fileExtension}`),
          );
          if (matchedFile) {
            fileRecordMap.set(candidate.originalKey, matchedFile);
          }
        }
      }
    }
  }

  // The old file key remains the public lookup alias. If Scholar has an
  // active head, serve only its verified immutable object under that alias.
  const fileIds = [
    ...new Set(
      [...fileRecordMap.values()]
        .filter(
          (record) =>
            typeof record.id === 'string' &&
            typeof record.book_hash === 'string' &&
            record.file_key.startsWith(`${userId}/Readest/Books/${record.book_hash}/`) &&
            !record.file_key.endsWith('/cover.png'),
        )
        .map((record) => record.id as string),
    ),
  ];
  const headByFileId = new Map<string, string>();
  const activeObjectByFileId = new Map<string, string>();
  if (fileIds.length > 0) {
    const headResults = await Promise.all(
      queryBatches(fileIds).map((batch) =>
        supabase
          .from('scholar_file_heads')
          .select('file_id,version_id')
          .eq('user_id', userId)
          .in('file_id', batch),
      ),
    );
    const headError = headResults.find((result) => result.error)?.error;
    if (headError && !['PGRST205', '42P01'].includes(headError.code)) {
      console.error('Error querying Scholar file heads:', headError);
      return Object.fromEntries(fileKeys.map((key) => [key, undefined]));
    }
    if (!headError) {
      for (const head of headResults.flatMap((result) => result.data || [])) {
        headByFileId.set(head.file_id, head.version_id);
      }
      const versionIds = [...new Set(headByFileId.values())];
      if (versionIds.length > 0) {
        const versionResults = await Promise.all(
          queryBatches(versionIds).map((batch) =>
            supabase
              .from('scholar_file_versions')
              .select('file_id,version_id,object_key')
              .eq('user_id', userId)
              .eq('state', 'ready')
              .in('version_id', batch),
          ),
        );
        const versionError = versionResults.find((result) => result.error)?.error;
        if (versionError) {
          console.error('Error querying Scholar file versions:', versionError);
          return Object.fromEntries(fileKeys.map((key) => [key, undefined]));
        }
        for (const version of versionResults.flatMap((result) => result.data || [])) {
          if (headByFileId.get(version.file_id) === version.version_id) {
            activeObjectByFileId.set(version.file_id, version.object_key);
          }
        }
      }
    }
  }

  const results = await Promise.allSettled(
    fileKeys.map(async (fileKey) => {
      const fileRecord = fileRecordMap.get(fileKey);

      if (!fileRecord) {
        return { fileKey, downloadUrl: undefined };
      }

      if (fileRecord.user_id !== userId) {
        return { fileKey, downloadUrl: undefined };
      }

      const hasHead = headByFileId.has(fileRecord.id);
      const objectKey = hasHead ? activeObjectByFileId.get(fileRecord.id) : fileRecord.file_key;
      if (!objectKey) return { fileKey, downloadUrl: undefined };

      try {
        const downloadUrl = await getDownloadSignedUrl(objectKey, 1800);
        return { fileKey, downloadUrl };
      } catch (error) {
        console.error('Error creating signed URL for %s:', fileKey, error);
        return { fileKey, downloadUrl: undefined };
      }
    }),
  );

  const downloadUrls: Record<string, string | undefined> = {};

  results.forEach((result, index) => {
    const fileKey = fileKeys[index]!;
    if (result.status === 'fulfilled') {
      downloadUrls[fileKey] = result.value.downloadUrl;
    } else {
      downloadUrls[fileKey] = undefined;
    }
  });

  return downloadUrls;
}
