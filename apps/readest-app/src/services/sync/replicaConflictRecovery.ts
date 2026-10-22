import { isCipherEnvelope } from '@/types/replica';
import { isOfflineReplayKind } from '@/libs/replicaSchemas';
import type { HlcGenerator } from '@/libs/crdt';
import type { FieldEnvelope, ReplicaRow } from '@/types/replica';

export interface ReplicaConflictVersion {
  user_id: string;
  kind: string;
  replica_id: string;
  source: 'previous' | 'incoming';
  version_hash: string;
  recorded_at: string;
  row_data: { fields_jsonb?: Record<string, FieldEnvelope> };
}

export interface RecoverableField {
  name: string;
  preview: string;
  restorable: boolean;
}

export interface RestoreFieldRequest {
  p_user_id: string;
  p_kind: string;
  p_replica_id: string;
  p_source: 'previous' | 'incoming';
  p_version_hash: string;
  p_field: string;
  p_expected_current: FieldEnvelope | null;
  p_new_hlc: string;
}

export interface ReplicaConflictTransport {
  fetchCurrent(userId: string, kind: string, replicaId: string): Promise<ReplicaRow>;
  restore(request: RestoreFieldRequest): Promise<ReplicaRow>;
}

const SENSITIVE_FIELD =
  /password|token|secret|userkey|accesskey|apikey|credential|customheaders|username|authorization/i;

const archivedFields = (version: ReplicaConflictVersion): Record<string, FieldEnvelope> =>
  version.row_data.fields_jsonb ?? {};

const isProtected = (name: string, field: FieldEnvelope): boolean =>
  SENSITIVE_FIELD.test(name) || isCipherEnvelope(field.v);

export const listRecoverableFields = (version: ReplicaConflictVersion): RecoverableField[] =>
  Object.entries(archivedFields(version)).flatMap<RecoverableField>(([name, field]) => {
    if (!field || typeof field !== 'object' || !('v' in field)) return [];
    if (isProtected(name, field)) {
      return [{ name, preview: 'Protected value', restorable: false }];
    }
    const raw = typeof field.v === 'string' ? field.v : JSON.stringify(field.v);
    return [{ name, preview: (raw ?? '').slice(0, 160), restorable: true }];
  });

/** Restore only if the server field still equals the version reviewed by this device. */
export const restoreReplicaField = async (
  version: ReplicaConflictVersion,
  fieldName: string,
  signedInUserId: string,
  hlc: HlcGenerator,
  transport: ReplicaConflictTransport,
): Promise<ReplicaRow> => {
  if (version.user_id !== signedInUserId) throw new Error('Conflict belongs to another account');
  if (!isOfflineReplayKind(version.kind))
    throw new Error('This replica kind needs manual recovery');
  const archived = archivedFields(version)[fieldName];
  if (!archived || isProtected(fieldName, archived)) {
    throw new Error('This field cannot be restored here');
  }
  const current = await transport.fetchCurrent(signedInUserId, version.kind, version.replica_id);
  if (
    current.user_id !== signedInUserId ||
    current.kind !== version.kind ||
    current.replica_id !== version.replica_id ||
    current.manifest_jsonb !== null ||
    current.deleted_at_ts !== null ||
    current.reincarnation !== null
  ) {
    throw new Error('The current replica cannot be restored as metadata');
  }
  const expected = current.fields_jsonb[fieldName] ?? null;
  if (expected) hlc.observe(expected.t);
  const newClock = hlc.next();
  return transport.restore({
    p_user_id: signedInUserId,
    p_kind: version.kind,
    p_replica_id: version.replica_id,
    p_source: version.source,
    p_version_hash: version.version_hash,
    p_field: fieldName,
    p_expected_current: expected,
    p_new_hlc: newClock,
  });
};
