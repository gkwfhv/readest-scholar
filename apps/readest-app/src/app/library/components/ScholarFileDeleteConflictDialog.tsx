import { useEffect, useState } from 'react';
import type { Book } from '@/types/book';
import type { TransferItem } from '@/store/transferStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getAPIBaseUrl } from '@/services/environment';
import { getScholarAccountId } from '@/services/scholarFileBaseline';
import { transferManager } from '@/services/transferManager';
import { fetchWithAuth } from '@/utils/fetch';

interface FileVersion {
  versionId: string;
  sha256: string;
  fileSize: number;
  verifiedAt: string;
}

interface Review {
  fileId: string;
  activeVersionId: string;
  version: FileVersion;
}

export default function ScholarFileDeleteConflictDialog({
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
      try {
        const accountId = await getScholarAccountId();
        if (
          !accountId ||
          accountId !== transfer.scholarAccountId ||
          !transfer.scholarFilePath ||
          !transfer.scholarOpId
        ) {
          throw new Error('Scholar delete account changed');
        }
        const fileKey = accountId + '/' + transfer.scholarFilePath;
        const statusResponse = await fetchWithAuth(
          getAPIBaseUrl() + '/scholar/files/status?fileKey=' + encodeURIComponent(fileKey),
          { method: 'GET' },
        );
        const status = (await statusResponse.json()) as {
          fileId: string;
          activeVersionId: string | null;
        };
        if (!status.fileId || !status.activeVersionId) {
          throw new Error('No current cloud version; refresh this dialog');
        }
        const historyResponse = await fetchWithAuth(
          getAPIBaseUrl() +
            '/scholar/files/history?fileId=' +
            encodeURIComponent(status.fileId) +
            '&versionId=' +
            encodeURIComponent(status.activeVersionId),
          { method: 'GET' },
        );
        const history = (await historyResponse.json()) as {
          fileId: string;
          activeVersionId: string | null;
          versions: FileVersion[];
        };
        const version = history.versions[0];
        if (
          !version ||
          version.versionId !== status.activeVersionId ||
          history.fileId !== status.fileId ||
          history.activeVersionId !== status.activeVersionId
        ) {
          throw new Error('Cloud version changed; reopen this dialog');
        }
        if (!cancelled)
          setReview({
            fileId: status.fileId,
            activeVersionId: status.activeVersionId,
            version,
          });
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : 'Could not load cloud version');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [transfer.scholarAccountId, transfer.scholarFilePath, transfer.scholarOpId]);

  const resolve = async (deleteCurrent: boolean) => {
    if (!review || busy) return;
    setBusy(true);
    setError('');
    try {
      if (deleteCurrent) {
        await transferManager.requeueScholarDeleteConflict(
          transfer.id,
          review.fileId,
          review.activeVersionId,
        );
      } else {
        await transferManager.keepScholarCloudAfterDeleteConflict(
          transfer.id,
          review.fileId,
          review.activeVersionId,
        );
      }
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not resolve Scholar delete conflict',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4'>
      <div
        role='dialog'
        aria-modal='true'
        aria-label={_('Resolve file delete conflict')}
        className='modal-box bg-base-100 w-full max-w-lg rounded-2xl p-5'
      >
        <h2 className='text-lg font-semibold'>{_('Resolve file delete conflict')}</h2>
        <p className='mt-1 text-sm'>{book.title}</p>
        <p className='text-base-content/70 mt-2 text-sm'>
          {_('This cloud file changed after deletion was queued. No remote bytes were deleted.')}
        </p>
        {review ? (
          <div className='eink-bordered border-base-300 mt-4 rounded-lg border p-3'>
            <div className='font-medium'>{_('Current cloud version')}</div>
            <div className='text-base-content/70 text-xs'>
              {new Date(review.version.verifiedAt).toLocaleString()} ·{' '}
              {(review.version.fileSize / 1024).toFixed(1)} KB
            </div>
            <div className='text-base-content/70 font-mono text-xs'>
              SHA-256: {review.version.sha256.slice(0, 16)}…
            </div>
          </div>
        ) : !error ? (
          <p className='mt-4 text-sm'>{_('Loading versions...')}</p>
        ) : null}
        {error && (
          <p role='alert' className='text-error mt-3 text-sm'>
            {_(error)}
          </p>
        )}
        <p className='text-base-content/70 mt-3 text-xs'>
          {_(
            'Keeping the cloud file restores its library entry. Purged reading data remains deleted.',
          )}
        </p>
        <div className='mt-5 flex flex-wrap justify-end gap-2'>
          <button type='button' className='btn btn-ghost eink-bordered' onClick={onClose}>
            {_('Close')}
          </button>
          <button
            type='button'
            className='btn btn-ghost eink-bordered'
            disabled={!review || busy}
            onClick={() => void resolve(false)}
          >
            {_('Keep cloud file')}
          </button>
          <button
            type='button'
            className='btn btn-contrast'
            disabled={!review || busy}
            onClick={() => void resolve(true)}
          >
            {_('Delete current cloud version')}
          </button>
        </div>
      </div>
    </div>
  );
}
