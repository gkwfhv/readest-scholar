import { useEffect, useState } from 'react';
import type { Book } from '@/types/book';
import type { TransferItem } from '@/store/transferStore';
import { useTranslation } from '@/hooks/useTranslation';
import { CLOUD_BOOKS_SUBDIR } from '@/services/constants';
import { getAPIBaseUrl } from '@/services/environment';
import { getScholarAccountId } from '@/services/scholarFileBaseline';
import { transferManager } from '@/services/transferManager';
import { getRemoteBookFilename } from '@/utils/book';
import { fetchWithAuth } from '@/utils/fetch';

interface FileVersion {
  versionId: string;
  opId: string;
  sha256: string;
  fileSize: number;
  verifiedAt: string;
}

interface Review {
  fileId: string;
  activeVersionId: string;
  cloud: FileVersion;
  local: FileVersion;
}

export default function ScholarFileConflictDialog({
  transfer,
  book,
  onClose,
}: {
  transfer: TransferItem;
  book: Book;
  onClose: () => void;
}) {
  const _ = useTranslation();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setReview(null);
      setError('');
      try {
        const accountId = await getScholarAccountId();
        if (!accountId || accountId !== transfer.scholarAccountId || !transfer.scholarOpId) {
          throw new Error('Scholar upload account changed');
        }
        const filePath = CLOUD_BOOKS_SUBDIR + '/' + getRemoteBookFilename(book);
        const statusResponse = await fetchWithAuth(
          getAPIBaseUrl() + '/scholar/files/status?fileKey=' +
            encodeURIComponent(accountId + '/' + filePath),
          { method: 'GET' },
        );
        const status = (await statusResponse.json()) as {
          fileId: string;
          activeVersionId: string | null;
        };
        const historyResponse = await fetchWithAuth(
          getAPIBaseUrl() + '/scholar/files/history?fileId=' + encodeURIComponent(status.fileId),
          { method: 'GET' },
        );
        const history = (await historyResponse.json()) as {
          fileId: string;
          activeVersionId: string | null;
          versions: FileVersion[];
        };
        const lookupVersion = async (key: 'versionId' | 'opId', value: string) => {
          const response = await fetchWithAuth(
            getAPIBaseUrl() + '/scholar/files/history?fileId=' +
              encodeURIComponent(status.fileId) + '&' + key + '=' + encodeURIComponent(value),
            { method: 'GET' },
          );
          const result = (await response.json()) as { versions: FileVersion[] };
          return result.versions[0];
        };
        const cloud = history.versions.find((v) => v.versionId === history.activeVersionId) ||
          (history.activeVersionId
            ? await lookupVersion('versionId', history.activeVersionId) : undefined);
        const local = history.versions.find((v) => v.opId === transfer.scholarOpId) ||
          await lookupVersion('opId', transfer.scholarOpId);
        if (
          !cloud || !local || !history.activeVersionId ||
          status.fileId !== history.fileId ||
          status.activeVersionId !== history.activeVersionId
        ) {
          throw new Error('File versions changed; reopen this dialog');
        }
        if (!cancelled) setReview({
          fileId: status.fileId,
          activeVersionId: history.activeVersionId,
          cloud,
          local,
        });
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load versions');
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [book, transfer.scholarAccountId, transfer.scholarOpId]);

  const resolve = async (useLocal: boolean) => {
    if (!review || busy) return;
    setBusy(true);
    setError('');
    try {
      // Both choices use the server-side compare-and-swap. A status read here
      // would leave a race before the queue baseline is updated.
      await fetchWithAuth(getAPIBaseUrl() + '/scholar/files/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: review.fileId,
          versionId: useLocal ? review.local.versionId : review.activeVersionId,
          expectedVersionId: review.activeVersionId,
        }),
      });
      await transferManager.finishScholarConflict(
        transfer.id,
        review.fileId,
        useLocal ? review.local.versionId : review.activeVersionId,
        useLocal,
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not resolve file conflict');
    } finally {
      setBusy(false);
    }
  };

  const versionCard = (label: string, version: FileVersion) => (
    <div className='eink-bordered border-base-300 rounded-lg border p-3'>
      <div className='font-medium'>{label}</div>
      <div className='text-base-content/70 text-xs'>
        {new Date(version.verifiedAt).toLocaleString()} · {(version.fileSize / 1024).toFixed(1)} KB
      </div>
      <div className='text-base-content/70 font-mono text-xs'>
        SHA-256: {version.sha256.slice(0, 16)}…
      </div>
    </div>
  );

  return (
    <div className='fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4'>
      <div role='dialog' aria-modal='true' aria-label={_('Resolve file conflict')}
        className='modal-box bg-base-100 w-full max-w-lg rounded-2xl p-5'>
        <h2 className='text-lg font-semibold'>{_('Resolve file conflict')}</h2>
        <p className='mt-1 text-sm'>{book.title}</p>
        <p className='text-base-content/70 mt-2 text-sm'>
          {_('Another device changed this file. Both verified versions are preserved.')}
        </p>
        {review ? (
          <div className='mt-4 flex flex-col gap-2'>
            {versionCard(_('Cloud version'), review.cloud)}
            {versionCard(_('This upload'), review.local)}
          </div>
        ) : !error ? <p className='mt-4 text-sm'>{_('Loading versions...')}</p> : null}
        {error && <p role='alert' className='text-error mt-3 text-sm'>{_(error)}</p>}
        <p className='text-base-content/70 mt-3 text-xs'>
          {_('Your local file stays on this device whichever version you choose.')}
        </p>
        <div className='mt-5 flex flex-wrap justify-end gap-2'>
          <button type='button' className='btn btn-ghost eink-bordered' onClick={onClose}>
            {_('Close')}
          </button>
          <button type='button' className='btn btn-ghost eink-bordered'
            disabled={!review || busy} onClick={() => void resolve(false)}>
            {_('Keep cloud version')}
          </button>
          <button type='button' className='btn btn-contrast'
            disabled={!review || busy} onClick={() => void resolve(true)}>
            {_('Use this upload')}
          </button>
        </div>
      </div>
    </div>
  );
}
