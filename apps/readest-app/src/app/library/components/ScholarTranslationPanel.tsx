import { useCallback, useEffect, useState } from 'react';
import type { Book } from '@/types/book';
import { CLOUD_BOOKS_SUBDIR } from '@/services/constants';
import { getAPIBaseUrl } from '@/services/environment';
import { getScholarAccountId } from '@/services/scholarFileBaseline';
import { getRemoteBookFilename } from '@/utils/book';
import { fetchWithAuth } from '@/utils/fetch';
import { eventDispatcher } from '@/utils/event';
import { useTranslation } from '@/hooks/useTranslation';

type Mode = 'mono' | 'dual' | 'both';
type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
interface Job {
  id: string;
  state: JobState;
  progress: number;
  mode: Mode;
  errorCode?: string | null;
  outputs?: { kind: 'mono' | 'dual'; downloadUrl: string; sha256: string; fileSize: number }[];
}
interface FileStatus {
  fileId: string;
  activeVersionId: string | null;
}

export default function ScholarTranslationPanel({ book }: { book: Book }) {
  const _ = useTranslation();
  const [status, setStatus] = useState<FileStatus | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [mode, setMode] = useState<Mode>('dual');
  const [glossarySha, setGlossarySha] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stateLabel: Record<JobState, string> = {
    queued: _('Queued'),
    running: _('Translating'),
    succeeded: _('Completed'),
    failed: _('Failed'),
    canceled: _('Canceled'),
  };

  const loadJob = useCallback(async (id: string) => {
    const response = await fetchWithAuth(
      getAPIBaseUrl() + '/scholar/translation-jobs/' + encodeURIComponent(id),
      { method: 'GET' },
    );
    const data = (await response.json()) as Job;
    setJob(data);
  }, []);

  useEffect(() => {
    let active = true;
    setStatus(null);
    setJob(null);
    setError('');
    setLoading(true);
    const load = async () => {
      try {
        const accountId = await getScholarAccountId();
        if (!accountId) throw new Error('Sign in to translate this PDF');
        const fileKey = accountId + '/' + CLOUD_BOOKS_SUBDIR + '/' + getRemoteBookFilename(book);
        const response = await fetchWithAuth(
          getAPIBaseUrl() + '/scholar/files/status?fileKey=' + encodeURIComponent(fileKey),
          { method: 'GET' },
        );
        const file = (await response.json()) as FileStatus;
        if (!active) return;
        setStatus(file);
        const jobsResponse = await fetchWithAuth(
          getAPIBaseUrl() + '/scholar/translation-jobs?fileId=' + encodeURIComponent(file.fileId),
          { method: 'GET' },
        );
        const history = (await jobsResponse.json()) as { jobs: Job[] };
        if (!active || !history.jobs[0]) return;
        const detailResponse = await fetchWithAuth(
          getAPIBaseUrl() + '/scholar/translation-jobs/' + encodeURIComponent(history.jobs[0].id),
          { method: 'GET' },
        );
        if (active) setJob((await detailResponse.json()) as Job);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load translation');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [book]);

  useEffect(() => {
    if (!job || (job.state !== 'queued' && job.state !== 'running')) return;
    const timer = window.setInterval(() => {
      void loadJob(job.id).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not update translation');
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [job, loadJob]);

  const openOutput = async (kind: 'mono' | 'dual') => {
    if (!job) return;
    const preview = window.open('about:blank', '_blank');
    try {
      const response = await fetchWithAuth(
        getAPIBaseUrl() + '/scholar/translation-jobs/' + encodeURIComponent(job.id),
        { method: 'GET' },
      );
      const fresh = (await response.json()) as Job;
      const output = fresh.outputs?.find((item) => item.kind === kind);
      if (!output) throw new Error('Translated PDF is unavailable');
      if (preview) {
        preview.opener = null;
        preview.location.replace(output.downloadUrl);
      } else {
        window.location.assign(output.downloadUrl);
      }
    } catch (cause) {
      preview?.close();
      setError(cause instanceof Error ? cause.message : 'Could not open translated PDF');
    }
  };

  const importOutput = async (kind: 'mono' | 'dual') => {
    if (!job || busy) return;
    setBusy(true);
    setError('');
    try {
      const detailResponse = await fetchWithAuth(
        getAPIBaseUrl() + '/scholar/translation-jobs/' + encodeURIComponent(job.id),
        { method: 'GET' },
      );
      const fresh = (await detailResponse.json()) as Job;
      if (fresh.state !== 'succeeded') throw new Error('Translation is not ready');
      const output = fresh.outputs?.find((item) => item.kind === kind);
      if (!output || output.fileSize > 200 * 1024 * 1024)
        throw new Error('Translated PDF is unavailable');
      const response = await fetch(output.downloadUrl);
      if (!response.ok) throw new Error('Could not download translated PDF');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== output.fileSize) throw new Error('Translated PDF size mismatch');
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
      if (digest !== output.sha256) throw new Error('Translated PDF checksum mismatch');
      const name = `Scholar-${job.id}-${kind}.pdf`;
      const file = new File([bytes], name, { type: 'application/pdf' });
      await eventDispatcher.dispatch('import-book-files', {
        files: [{ file }],
        groupId: book.groupId ?? '',
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import translated PDF');
    } finally {
      setBusy(false);
    }
  };

  const uploadGlossary = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      if (file.size > 65536) throw new Error('Glossary must be 64 KiB or smaller');
      const csv = await file.text();
      const response = await fetchWithAuth(getAPIBaseUrl() + '/scholar/translation-glossaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      const result = (await response.json()) as { sha256: string };
      setGlossarySha(result.sha256);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save glossary');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (action: 'start' | 'cancel' | 'retry') => {
    if (!status || busy) return;
    setBusy(true);
    setError('');
    try {
      const path =
        action === 'start'
          ? '/scholar/translation-jobs'
          : '/scholar/translation-jobs/' +
            encodeURIComponent(job!.id) +
            (action === 'cancel' ? '/cancel' : '/retry');
      const body =
        action === 'start'
          ? {
              fileId: status.fileId,
              versionId: status.activeVersionId,
              idempotencyKey: crypto.randomUUID(),
              mode,
              ...(glossarySha ? { glossarySha256: glossarySha } : {}),
            }
          : action === 'retry'
            ? { idempotencyKey: crypto.randomUUID() }
            : {};
      const response = await fetchWithAuth(getAPIBaseUrl() + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const next = (await response.json()) as Job;
      await loadJob(next.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Translation request failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={_('PDF translation')} className='mt-5 border-t border-base-300 pt-4'>
      <h3 className='text-sm font-semibold'>{_('PDF translation')}</h3>
      <p className='mb-3 text-xs text-base-content/65'>
        {_('Create a translated copy while keeping the original PDF')}
      </p>
      {loading && <p className='text-xs text-base-content/60'>{_('Loading...')}</p>}
      {error && (
        <p role='alert' className='mb-2 text-xs text-error'>
          {error}
        </p>
      )}
      {status?.activeVersionId && (
        <div className='flex flex-wrap items-center gap-2'>
          <label className='text-xs' htmlFor='scholar-translation-mode'>
            {_('Output')}
          </label>
          <select
            id='scholar-translation-mode'
            className='select select-bordered select-sm eink-bordered'
            value={mode}
            onChange={(event) => setMode(event.target.value as Mode)}
            disabled={busy}
          >
            <option value='dual'>{_('Bilingual')}</option>
            <option value='mono'>{_('Chinese')}</option>
            <option value='both'>{_('Both')}</option>
          </select>
          <label className='text-xs'>
            {_('Glossary CSV')}
            <input
              className='file-input file-input-bordered file-input-xs eink-bordered mt-1 block max-w-48'
              type='file'
              accept='.csv,text/csv'
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadGlossary(file);
              }}
            />
          </label>
          {glossarySha && <span className='text-xs text-success'>{_('Glossary ready')}</span>}
          <button
            type='button'
            className='btn btn-sm btn-contrast'
            disabled={busy}
            onClick={() => void submit('start')}
          >
            {_('Translate')}
          </button>
        </div>
      )}
      {!loading && status && !status.activeVersionId && (
        <p className='text-xs text-base-content/60'>
          {_('Upload this PDF to Scholar before translating.')}
        </p>
      )}
      {job && (
        <div className='mt-3 text-xs'>
          <p aria-live='polite'>
            {stateLabel[job.state]} · {job.progress}% ·{' '}
            {job.mode === 'dual' ? _('Bilingual') : job.mode === 'mono' ? _('Chinese') : _('Both')}
          </p>
          {job.errorCode && (
            <p role='alert' className='text-error'>
              {job.errorCode}
            </p>
          )}
          {(job.state === 'queued' || job.state === 'running') && (
            <button
              type='button'
              className='btn btn-ghost btn-xs eink-bordered mt-2'
              disabled={busy}
              onClick={() => void submit('cancel')}
            >
              {_('Cancel')}
            </button>
          )}
          {(job.state === 'failed' || job.state === 'canceled') && (
            <button
              type='button'
              className='btn btn-ghost btn-xs eink-bordered mt-2'
              disabled={busy}
              onClick={() => void submit('retry')}
            >
              {_('Retry')}
            </button>
          )}
          {job.outputs?.map((output) => (
            <div key={output.kind} className='mt-2 flex flex-wrap items-center gap-2'>
              <button
                type='button'
                className='btn btn-ghost btn-xs eink-bordered'
                onClick={() => void openOutput(output.kind)}
              >
                {output.kind === 'dual' ? _('Open bilingual PDF') : _('Open Chinese PDF')}
              </button>
              <button
                type='button'
                className='btn btn-ghost btn-xs eink-bordered'
                disabled={busy}
                onClick={() => void importOutput(output.kind)}
              >
                {_('Add to library')}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
