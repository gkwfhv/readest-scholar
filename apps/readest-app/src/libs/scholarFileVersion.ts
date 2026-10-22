import { getAPIBaseUrl, isWebAppPlatform } from '@/services/environment';
import { sha256File } from '@/services/dictionaries/plugins/integrity';
import { getAccessToken } from '@/utils/access';
import { tauriUpload, webUpload, type ProgressHandler } from '@/utils/transfer';

type PrepareResult = {
  versionId: string;
  state: 'pending' | 'ready';
  uploadUrl?: string;
  headers?: Record<string, string>;
};

export type ScholarFileVersionResult = {
  versionId: string;
  applied: boolean;
  activeVersionId: string | null;
};

/**
 * The caller owns and persists opId until completion. Reusing it after a lost
 * response recovers the same reservation and never publishes unchecked bytes.
 */
export async function uploadScholarFileVersion(
  file: File,
  fileId: string,
  opId: string,
  expectedVersionId: string | null,
  onProgress?: ProgressHandler,
  fileFullPath?: string,
): Promise<ScholarFileVersionResult> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated');
  if (!isWebAppPlatform() && !fileFullPath) throw new Error('Native file path is required');
  const sha256 = await sha256File(file);
  const endpoint = `${getAPIBaseUrl()}/scholar/files`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Scholar-Protocol': '1',
    'X-Scholar-Capabilities': 'immutable-file-versions-v1',
  };
  const prepareResponse = await fetch(`${endpoint}/prepare`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ fileId, opId, sha256, fileSize: file.size }),
  });
  const prepared = (await prepareResponse.json()) as PrepareResult & { error?: string };
  if (!prepareResponse.ok) throw new Error(prepared.error || 'Could not reserve file version');
  if (!prepared.versionId || !['pending', 'ready'].includes(prepared.state)) {
    throw new Error('Invalid file reservation response');
  }

  let uploadError: unknown;
  if (prepared.state === 'pending') {
    if (!prepared.uploadUrl || prepared.headers?.['If-None-Match'] !== '*') {
      throw new Error('Invalid conditional upload response');
    }
    try {
      if (isWebAppPlatform()) {
        await webUpload(file, prepared.uploadUrl, onProgress, prepared.headers);
      } else {
        await tauriUpload(
          prepared.uploadUrl, fileFullPath!, 'PUT', onProgress,
          new Map(Object.entries(prepared.headers)),
        );
      }
    } catch (error) {
      // A lost 200 response may make the retry return 412. The server reads
      // and hashes the stored object below; only matching bytes can complete.
      uploadError = error;
    }
  }

  const completeResponse = await fetch(`${endpoint}/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ fileId, opId, expectedVersionId }),
  });
  const completed = (await completeResponse.json()) as ScholarFileVersionResult & {
    error?: string;
  };
  if (
    (completeResponse.ok || completeResponse.status === 409) &&
    completed.versionId === prepared.versionId &&
    typeof completed.applied === 'boolean'
  ) {
    return {
      versionId: completed.versionId,
      applied: completed.applied,
      activeVersionId: completed.activeVersionId,
    };
  }
  if (uploadError) throw uploadError;
  throw new Error(completed.error || 'Could not verify file version');
}
