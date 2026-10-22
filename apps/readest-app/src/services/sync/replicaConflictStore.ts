import type { FieldEnvelope, ReplicaRow } from '@/types/replica';

const PREFIX = 'readest.replica.conflict.v1:';

export interface ReplicaFieldConflict {
  userId: string;
  kind: string;
  replicaId: string;
  field: string;
  local: FieldEnvelope;
  remote: FieldEnvelope | null;
  capturedAt: number;
}

/**
 * Keep a losing local field version before its outbox entry is removed.
 * The key is stable across retry after a lost response, so duplicate pushes
 * cannot create duplicate conflicts. Storage errors propagate and keep the
 * outbox intact.
 */
export class LocalStorageReplicaConflictStore {
  constructor(private readonly storage: Storage = localStorage) {}

  record(sent: ReplicaRow, merged: ReplicaRow): void {
    if (
      sent.user_id !== merged.user_id ||
      sent.kind !== merged.kind ||
      sent.replica_id !== merged.replica_id
    ) {
      throw new Error('Replica merge response identity mismatch');
    }
    for (const [field, local] of Object.entries(sent.fields_jsonb)) {
      const remote = merged.fields_jsonb[field] ?? null;
      if (remote && JSON.stringify(local) === JSON.stringify(remote)) continue;
      const key =
        PREFIX +
        JSON.stringify([sent.user_id, sent.kind, sent.replica_id, field, local.t, local.s]);
      if (this.storage.getItem(key) !== null) continue;
      const conflict: ReplicaFieldConflict = {
        userId: sent.user_id,
        kind: sent.kind,
        replicaId: sent.replica_id,
        field,
        local,
        remote,
        capturedAt: Date.now(),
      };
      this.storage.setItem(key, JSON.stringify(conflict));
    }
  }

  load(userId: string): ReplicaFieldConflict[] {
    const conflicts: ReplicaFieldConflict[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const raw = this.storage.getItem(key);
      if (!raw) continue;
      try {
        const value = JSON.parse(raw) as ReplicaFieldConflict;
        if (value.userId === userId) conflicts.push(value);
      } catch {
        // Leave damaged entries in place for diagnosis.
      }
    }
    return conflicts.sort((a, b) => a.capturedAt - b.capturedAt);
  }
}
