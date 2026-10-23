'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { createSupabaseClient } from '@/utils/supabase';
import { getReplicaSync, subscribeReplicaSyncReady } from '@/services/sync/replicaSync';
import {
  listRecoverableFields,
  restoreReplicaField,
  type ReplicaConflictVersion,
  type RestoreFieldRequest,
} from '@/services/sync/replicaConflictRecovery';
import { isOfflineReplayKind } from '@/libs/replicaSchemas';
import type { ReplicaRow } from '@/types/replica';

type ReviewedVersion =
  | { status: 'loading' }
  | { status: 'ready'; row: ReplicaRow }
  | { status: 'error' };

interface Props {
  userId: string;
  token: string;
}

/** Account-scoped recovery from the append-only server history. */
export function SyncConflictHistorySection({ userId, token }: Props) {
  const _ = useTranslation();
  const [versions, setVersions] = useState<ReplicaConflictVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [syncReady, setSyncReady] = useState(() => getReplicaSync() !== null);
  const [reviewed, setReviewed] = useState<Record<string, ReviewedVersion>>({});
  const reviewGeneration = useRef(0);

  useEffect(() => subscribeReplicaSyncReady(() => setSyncReady(true)), []);

  const fetchCurrent = useCallback(
    async (account: string, kind: string, replicaId: string): Promise<ReplicaRow> => {
      const client = createSupabaseClient(token);
      const { data, error: fetchError } = await client
        .from('replicas')
        .select('*')
        .eq('user_id', account)
        .eq('kind', kind)
        .eq('replica_id', replicaId)
        .single();
      if (fetchError || !data) throw fetchError ?? new Error('Replica not found');
      return data as ReplicaRow;
    },
    [token],
  );

  const review = async (version: ReplicaConflictVersion, key: string) => {
    const generation = reviewGeneration.current;
    setReviewed((previous) => ({ ...previous, [key]: { status: 'loading' } }));
    try {
      const row = await fetchCurrent(userId, version.kind, version.replica_id);
      if (generation === reviewGeneration.current) {
        setReviewed((previous) => ({ ...previous, [key]: { status: 'ready', row } }));
      }
    } catch {
      if (generation === reviewGeneration.current) {
        setReviewed((previous) => ({ ...previous, [key]: { status: 'error' } }));
      }
    }
  };

  const load = useCallback(async () => {
    const generation = ++reviewGeneration.current;
    setReviewed({});
    setVersions([]);
    setLoading(true);
    setError(null);
    try {
      const client = createSupabaseClient(token);
      const { data, error: queryError } = await client
        .from('replica_conflict_versions')
        .select('user_id,kind,replica_id,source,version_hash,row_data,recorded_at')
        .eq('user_id', userId)
        .order('recorded_at', { ascending: false })
        .limit(50);
      if (queryError) throw queryError;
      if (generation === reviewGeneration.current) {
        setVersions((data ?? []) as ReplicaConflictVersion[]);
      }
    } catch {
      if (generation === reviewGeneration.current) {
        setError(_('Could not load sync recovery history.'));
      }
    } finally {
      if (generation === reviewGeneration.current) setLoading(false);
    }
  }, [token, userId, _]);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (version: ReplicaConflictVersion, fieldName: string) => {
    const ctx = getReplicaSync();
    if (!ctx) {
      setError(_('Sync is still starting. Try again in a moment.'));
      return;
    }
    const versionKey = [
      version.kind,
      version.replica_id,
      version.source,
      version.version_hash,
    ].join(':');
    const snapshot = reviewed[versionKey];
    if (snapshot?.status !== 'ready') return;
    const key = [version.version_hash, fieldName].join(':');
    setBusy(key);
    setError(null);
    setSuccess(false);
    try {
      const client = createSupabaseClient(token);
      await restoreReplicaField(version, fieldName, userId, snapshot.row, ctx.hlc, {
        fetchCurrent,
        restore: async (request: RestoreFieldRequest) => {
          const { data, error: restoreError } = await client
            .rpc('restore_replica_field_v1', request)
            .single();
          if (restoreError || !data) throw restoreError ?? new Error('Restore failed');
          return data as ReplicaRow;
        },
      });
      setSuccess(true);
      await load();
    } catch (cause) {
      const code = (cause as { code?: string })?.code;
      setError(
        code === '40001'
          ? _('This field changed on another device. Refresh the history before restoring it.')
          : _('Could not restore this sync version.'),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className='flex flex-col gap-3' aria-label={_('Recoverable sync versions')}>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h3 className='text-base-content text-lg font-semibold'>
            {_('Recoverable sync versions')}
          </h3>
          <p className='text-base-content/70 text-sm'>
            {_(
              'Review older metadata values before restoring one field. Recent versions appear first.',
            )}
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
          {_('Version restored on the server.')}{' '}
          <a className='link' href='/library'>
            {_('Open library to sync this device')}
          </a>
        </p>
      )}
      {loading ? (
        <p className='text-base-content/65 text-sm'>{_('Loading sync history...')}</p>
      ) : versions.length === 0 ? (
        <p className='text-base-content/65 text-sm'>{_('No recoverable versions yet.')}</p>
      ) : (
        <ul className='flex flex-col gap-2'>
          {versions.map((version) => {
            const fields = listRecoverableFields(version);
            const key = [
              version.kind,
              version.replica_id,
              version.source,
              version.version_hash,
            ].join(':');
            const title =
              version.kind === 'settings' && version.replica_id === 'singleton'
                ? _('App settings')
                : version.kind + ' / ' + version.replica_id;
            return (
              <li key={key}>
                <details
                  className='eink-bordered border-base-300 rounded-lg border p-3'
                  onToggle={(event) => {
                    if (event.currentTarget.open) void review(version, key);
                  }}
                >
                  <summary className='text-base-content cursor-pointer text-sm font-medium break-all'>
                    {title}
                    <span className='text-base-content/60 ms-2 font-normal'>
                      {version.source === 'incoming'
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
                  <ul className='mt-3 flex flex-col gap-2'>
                    {fields.map((field) => (
                      <li key={field.name} className='bg-base-200 eink-bordered rounded-md p-3'>
                        <div className='flex flex-wrap items-start justify-between gap-2'>
                          <div className='min-w-0 flex-1'>
                            <p className='text-base-content text-sm font-medium break-all'>
                              {field.name}
                            </p>
                            <p className='text-base-content/70 mt-1 text-xs break-all whitespace-pre-wrap'>
                              {field.restorable ? field.preview : _('Protected value')}
                            </p>
                          </div>
                          {field.restorable && isOfflineReplayKind(version.kind) && (
                            <button
                              type='button'
                              className='btn btn-contrast btn-sm shrink-0'
                              disabled={
                                !syncReady || busy !== null || reviewed[key]?.status !== 'ready'
                              }
                              onClick={() => void restore(version, field.name)}
                            >
                              {busy === [version.version_hash, field.name].join(':')
                                ? _('Restoring...')
                                : _('Restore this field')}
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
