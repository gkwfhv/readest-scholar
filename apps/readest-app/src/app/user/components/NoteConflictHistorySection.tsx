'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { createSupabaseClient } from '@/utils/supabase';

type NoteRow = Record<string, unknown> & {
  user_id: string;
  book_hash: string;
  id: string;
  note?: string | null;
  text?: string | null;
  page?: number | null;
  deleted_at?: string | null;
};

type NoteVersion = {
  user_id: string;
  book_hash: string;
  note_id: string;
  source: 'previous' | 'incoming';
  version_hash: string;
  recorded_at: string;
  row_data: NoteRow;
};

type Review = { status: 'loading' } | { status: 'ready'; row: NoteRow } | { status: 'error' };

interface Props {
  userId: string;
  token: string;
}

/** Review and restore one note version without overwriting a later device edit. */
export function NoteConflictHistorySection({ userId, token }: Props) {
  const _ = useTranslation();
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewed, setReviewed] = useState<Record<string, Review>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const reviewGeneration = useRef(0);

  const fetchCurrent = useCallback(
    async (version: NoteVersion): Promise<NoteRow> => {
      const { data, error: fetchError } = await createSupabaseClient(token)
        .from('book_notes')
        .select('*')
        .eq('user_id', userId)
        .eq('book_hash', version.book_hash)
        .eq('id', version.note_id)
        .single();
      if (fetchError || !data) throw fetchError ?? new Error('Note not found');
      return data as NoteRow;
    },
    [token, userId],
  );

  const load = useCallback(async () => {
    const generation = ++reviewGeneration.current;
    setReviewed({});
    setVersions([]);
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await createSupabaseClient(token)
        .from('book_note_conflict_versions')
        .select('user_id,book_hash,note_id,source,version_hash,row_data,recorded_at')
        .eq('user_id', userId)
        .order('recorded_at', { ascending: false })
        .limit(50);
      if (queryError) throw queryError;
      if (generation === reviewGeneration.current) {
        setVersions((data ?? []).filter((row) => row.user_id === userId) as NoteVersion[]);
      }
    } catch {
      if (generation === reviewGeneration.current) {
        setError(_('Could not load note recovery history.'));
      }
    } finally {
      if (generation === reviewGeneration.current) setLoading(false);
    }
  }, [token, userId, _]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (version: NoteVersion, key: string) => {
    const generation = reviewGeneration.current;
    setReviewed((previous) => ({ ...previous, [key]: { status: 'loading' } }));
    try {
      const row = await fetchCurrent(version);
      if (generation === reviewGeneration.current) {
        setReviewed((previous) => ({ ...previous, [key]: { status: 'ready', row } }));
      }
    } catch {
      if (generation === reviewGeneration.current) {
        setReviewed((previous) => ({ ...previous, [key]: { status: 'error' } }));
      }
    }
  };

  const restore = async (version: NoteVersion, key: string) => {
    const snapshot = reviewed[key];
    if (snapshot?.status !== 'ready' || busy !== null) return;
    setBusy(key);
    setError(null);
    setSuccess(false);
    try {
      const { data, error: restoreError } = await createSupabaseClient(token)
        .rpc('restore_book_note_version_v1', {
          p_user_id: userId,
          p_book_hash: version.book_hash,
          p_note_id: version.note_id,
          p_source: version.source,
          p_version_hash: version.version_hash,
          p_expected_current: snapshot.row,
        })
        .single();
      if (restoreError || !data) throw restoreError ?? new Error('Restore failed');
      setSuccess(true);
      await load();
    } catch (cause) {
      setError(
        ['PT409', '40001'].includes((cause as { code?: string })?.code ?? '')
          ? _('This note changed on another device. Refresh before restoring it.')
          : _('Could not restore this note version.'),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className='flex flex-col gap-3' aria-label={_('Recoverable note versions')}>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h3 className='text-base-content text-lg font-semibold'>
            {_('Recoverable note versions')}
          </h3>
          <p className='text-base-content/70 text-sm'>
            {_('Review an older note before restoring it. Recent versions appear first.')}
          </p>
        </div>
        <button
          type='button'
          className='btn btn-ghost btn-sm eink-bordered'
          onClick={() => void load()}
          disabled={loading}
        >
          {_('Refresh')}
        </button>
      </div>
      {error && (
        <p className='text-error text-sm' role='alert'>
          {error}
        </p>
      )}
      {success && (
        <p className='text-success text-sm' role='status'>
          {_('Note version restored on the server.')}{' '}
          <a className='link' href='/library'>
            {_('Open library to sync this device')}
          </a>
        </p>
      )}
      {loading ? (
        <p className='text-base-content/65 text-sm'>{_('Loading note history...')}</p>
      ) : versions.length === 0 ? (
        <p className='text-base-content/65 text-sm'>{_('No recoverable note versions yet.')}</p>
      ) : (
        <ul className='flex flex-col gap-2'>
          {versions.map((version) => {
            const key = [
              version.book_hash,
              version.note_id,
              version.source,
              version.version_hash,
            ].join(':');
            const preview =
              version.row_data.note?.trim() ||
              version.row_data.text?.trim() ||
              _('Bookmark or drawing');
            return (
              <li key={key}>
                <details
                  className='eink-bordered border-base-300 rounded-lg border p-3'
                  onToggle={(event) => {
                    if (event.currentTarget.open) void review(version, key);
                  }}
                >
                  <summary className='text-base-content cursor-pointer text-sm font-medium break-words whitespace-pre-wrap'>
                    {preview.slice(0, 160)}
                    <span className='text-base-content/60 ms-2 font-normal'>
                      {version.row_data.page != null && `${_('Page')} ${version.row_data.page} · `}
                      {version.row_data.deleted_at
                        ? _('Deleted note')
                        : version.source === 'incoming'
                          ? _('Older device version')
                          : _('Previous server version')}
                      {' · '}
                      {new Date(version.recorded_at).toLocaleString()}
                    </span>
                  </summary>
                  {reviewed[key]?.status === 'loading' && (
                    <p className='text-base-content/65 mt-3 text-xs'>
                      {_('Checking current version...')}
                    </p>
                  )}
                  {reviewed[key]?.status === 'error' && (
                    <p className='text-error mt-3 text-xs'>
                      {_('Could not check current version. Reopen this record.')}
                    </p>
                  )}
                  <div className='mt-3 flex flex-wrap items-center justify-between gap-3'>
                    <p className='text-base-content/65 text-xs'>
                      {_('Restoring this version will make it the current note on other devices.')}
                    </p>
                    <button
                      type='button'
                      className='btn btn-contrast btn-sm'
                      disabled={busy !== null || reviewed[key]?.status !== 'ready'}
                      onClick={() => void restore(version, key)}
                    >
                      {busy === key ? _('Restoring...') : _('Restore this note')}
                    </button>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
