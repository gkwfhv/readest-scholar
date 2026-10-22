import { getAccessToken } from '@/utils/access';
import { getAPIBaseUrl } from '@/services/environment';
import { SyncError } from '@/libs/errors';
import type { Hlc, ReplicaRow } from '@/types/replica';
import type { SyncErrorCode } from '@/libs/errors';

const ENDPOINT = () => `${getAPIBaseUrl()}/sync/replicas`;
const KEYS_ENDPOINT = () => `${getAPIBaseUrl()}/sync/replica-keys`;
const CHANGES_ENDPOINT = () => `${getAPIBaseUrl()}/sync/replica-changes`;

export interface ReplicaKeyRow {
  saltId: string;
  alg: string;
  salt: string;
  createdAt: string;
}

export interface ReplicaChangePage {
  changes: { seq: string; row: ReplicaRow }[];
  nextCursor: string;
  hasMore: boolean;
}

const isChangeCursor = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^(0|[1-9][0-9]*)$/.test(value) &&
  value.length <= 19 &&
  BigInt(value) <= 9223372036854775807n;

const parseChangePage = (
  value: unknown,
  kind: string,
  after: string,
  limit: number,
): ReplicaChangePage => {
  if (typeof value !== 'object' || value === null) {
    throw new SyncError('SERVER', 'Invalid replica change page');
  }
  const page = value as Record<string, unknown>;
  if (
    !Array.isArray(page['changes']) ||
    page['changes'].length > limit ||
    typeof page['hasMore'] !== 'boolean' ||
    !isChangeCursor(page['nextCursor'])
  ) {
    throw new SyncError('SERVER', 'Invalid replica change page');
  }
  const changes: ReplicaChangePage['changes'] = [];
  let previous = BigInt(after);
  for (const item of page['changes']) {
    if (typeof item !== 'object' || item === null) {
      throw new SyncError('SERVER', 'Invalid replica change row');
    }
    const change = item as Record<string, unknown>;
    const row = change['row'];
    if (
      !isChangeCursor(change['seq']) ||
      BigInt(change['seq']) <= previous ||
      typeof row !== 'object' ||
      row === null ||
      (row as Record<string, unknown>)['kind'] !== kind
    ) {
      throw new SyncError('SERVER', 'Invalid replica change row');
    }
    previous = BigInt(change['seq']);
    changes.push({ seq: change['seq'], row: row as ReplicaRow });
  }
  if (
    page['nextCursor'] !== (changes.at(-1)?.seq ?? after) ||
    (page['hasMore'] && changes.length !== limit)
  ) {
    throw new SyncError('SERVER', 'Invalid replica change cursor');
  }
  return { changes, nextCursor: page['nextCursor'], hasMore: page['hasMore'] };
};

interface ErrorBody {
  error?: string;
  code?: SyncErrorCode;
  offendingIndex?: number;
}

const statusToDefaultCode = (status: number): SyncErrorCode => {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 402 || status === 507) return 'QUOTA_EXCEEDED';
  if (status === 409) return 'CLOCK_SKEW';
  if (status === 413) return 'VALIDATION';
  if (status === 422) return 'VALIDATION';
  if (status >= 500) return 'SERVER';
  return 'VALIDATION';
};

const parseErrorBody = async (response: Response): Promise<ErrorBody> => {
  try {
    return (await response.json()) as ErrorBody;
  } catch {
    return {};
  }
};

const requireToken = async (): Promise<string> => {
  const token = await getAccessToken();
  if (!token) throw new SyncError('AUTH', 'Not authenticated');
  return token;
};

export class ReplicaSyncClient {
  async push(rows: ReplicaRow[]): Promise<ReplicaRow[]> {
    if (rows.length === 0) return [];
    const token = await requireToken();
    let response: Response;
    try {
      response = await fetch(ENDPOINT(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ protocolVersion: 2, rows }),
      });
    } catch (cause) {
      throw new SyncError('SERVER', 'Network failure during push', { cause });
    }
    if (!response.ok) {
      const body = await parseErrorBody(response);
      const code = body.code ?? statusToDefaultCode(response.status);
      throw new SyncError(code, body.error ?? `Push failed with status ${response.status}`, {
        status: response.status,
      });
    }
    const data = (await response.json()) as { rows: ReplicaRow[] };
    return data.rows ?? [];
  }

  /** Versioned pull. null means this backend has not deployed the new route. */
  async pullChanges(kind: string, after: string, limit = 100): Promise<ReplicaChangePage | null> {
    if (!isChangeCursor(after) || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new SyncError('VALIDATION', 'Invalid replica change cursor or page size');
    }
    const token = await requireToken();
    const params = new URLSearchParams({ kind, after, limit: String(limit) });
    let response: Response;
    try {
      response = await fetch(CHANGES_ENDPOINT() + '?' + params.toString(), {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
      });
    } catch (cause) {
      throw new SyncError('SERVER', 'Network failure during change pull', { cause });
    }
    if (response.status === 404) return null;
    if (!response.ok) {
      const body = await parseErrorBody(response);
      const code = body.code ?? statusToDefaultCode(response.status);
      throw new SyncError(code, body.error ?? 'Change pull failed with status ' + response.status, {
        status: response.status,
      });
    }
    try {
      return parseChangePage(await response.json(), kind, after, limit);
    } catch (cause) {
      if (cause instanceof SyncError) throw cause;
      throw new SyncError('SERVER', 'Invalid replica change page', { cause });
    }
  }

  async pull(kind: string, since: Hlc | null): Promise<ReplicaRow[]> {
    const token = await requireToken();
    const params = new URLSearchParams({ kind });
    if (since) params.set('since', since);
    const url = `${ENDPOINT()}?${params.toString()}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (cause) {
      throw new SyncError('SERVER', 'Network failure during pull', { cause });
    }
    if (response.status === 404) return [];
    if (!response.ok) {
      const body = await parseErrorBody(response);
      const code = body.code ?? statusToDefaultCode(response.status);
      throw new SyncError(code, body.error ?? `Pull failed with status ${response.status}`, {
        status: response.status,
      });
    }
    const data = (await response.json()) as { rows: ReplicaRow[] };
    return data.rows ?? [];
  }

  /**
   * Batched pull for the incremental auto-sync path. Collapses what
   * used to be N parallel `GET /api/sync/replicas?kind=…&since=…`
   * requests (one per replica kind, fired on every focus / online /
   * periodic trigger) into a single POST round-trip. The boot path
   * still uses `pull()` per kind to preserve the settings-first
   * ordering invariant.
   *
   * The endpoint is the same `/sync/replicas` route — `{ cursors: [...] }`
   * in the body discriminates batched-pull from `{ rows: [...] }` push.
   */
  async pullBatch(
    cursors: { kind: string; since: Hlc | null }[],
  ): Promise<{ kind: string; rows: ReplicaRow[] }[]> {
    if (cursors.length === 0) return [];
    const token = await requireToken();
    let response: Response;
    try {
      response = await fetch(ENDPOINT(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cursors }),
      });
    } catch (cause) {
      throw new SyncError('SERVER', 'Network failure during batch pull', { cause });
    }
    if (!response.ok) {
      const body = await parseErrorBody(response);
      const code = body.code ?? statusToDefaultCode(response.status);
      throw new SyncError(code, body.error ?? `Batch pull failed with status ${response.status}`, {
        status: response.status,
      });
    }
    const data = (await response.json()) as { results: { kind: string; rows: ReplicaRow[] }[] };
    return data.results ?? [];
  }

  /**
   * The replica_keys list rarely changes — only on `createReplicaKey`
   * (passphrase setup / rotation) and `forgetReplicaKeys` (forgot-
   * passphrase wipe), both of which we own and invalidate explicitly.
   * Without a cache here, every consumer that needs the salt list
   * (CryptoSession.unlock, tryRestoreFromStore, deriveKeyFor on a
   * cache-miss saltId, passphraseGate.ensurePassphraseUnlocked,
   * SyncPassphraseSection.refreshStatus) issues its own fetch in
   * parallel — observed as 5+ identical concurrent GETs at boot.
   *
   * Two-layer dedupe:
   *   * `replicaKeysInflight` coalesces concurrent calls onto the same
   *     in-flight promise — no duplicate network round trips even
   *     before the first response lands.
   *   * `replicaKeysCache` holds the resolved value indefinitely for
   *     subsequent calls. Invalidated on every mutation we issue.
   */
  private replicaKeysCache: ReplicaKeyRow[] | null = null;
  private replicaKeysInflight: Promise<ReplicaKeyRow[]> | null = null;

  /** Discard the cached replica_keys list. Auth flows / sign-out should call this. */
  invalidateReplicaKeysCache(): void {
    this.replicaKeysCache = null;
    this.replicaKeysInflight = null;
  }

  private async fetchReplicaKeys(): Promise<ReplicaKeyRow[]> {
    const token = await requireToken();
    let response: Response;
    try {
      response = await fetch(KEYS_ENDPOINT(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (cause) {
      throw new SyncError('SERVER', 'Network failure during replica-keys list', { cause });
    }
    if (!response.ok) {
      const body = await parseErrorBody(response);
      const code = body.code ?? statusToDefaultCode(response.status);
      throw new SyncError(
        code,
        body.error ?? `replica-keys list failed with status ${response.status}`,
        { status: response.status },
      );
    }
    const data = (await response.json()) as { rows: ReplicaKeyRow[] };
    return data.rows ?? [];
  }

  async listReplicaKeys(): Promise<ReplicaKeyRow[]> {
    if (this.replicaKeysCache !== null) {
      // Defensive copy — callers occasionally mutate the returned array
      // (e.g., `[...rows].sort(...)`). Returning the cache directly
      // would let one caller's mutation poison another's view.
      return [...this.replicaKeysCache];
    }
    if (this.replicaKeysInflight) {
      const rows = await this.replicaKeysInflight;
      return [...rows];
    }
    this.replicaKeysInflight = this.fetchReplicaKeys()
      .then((rows) => {
        this.replicaKeysCache = rows;
        return rows;
      })
      .finally(() => {
        this.replicaKeysInflight = null;
      });
    const rows = await this.replicaKeysInflight;
    return [...rows];
  }

  async forgetReplicaKeys(): Promise<void> {
    const token = await requireToken();
    let response: Response;
    try {
      response = await fetch(KEYS_ENDPOINT(), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (cause) {
      throw new SyncError('SERVER', 'Network failure during replica-keys forget', { cause });
    }
    if (!response.ok) {
      const body = await parseErrorBody(response);
      const code = body.code ?? statusToDefaultCode(response.status);
      throw new SyncError(
        code,
        body.error ?? `replica-keys forget failed with status ${response.status}`,
        { status: response.status },
      );
    }
    // Server side: every salt + every encrypted envelope is gone.
    // Local cache is now lying — clear it.
    this.replicaKeysCache = [];
  }

  async createReplicaKey(alg: string): Promise<ReplicaKeyRow> {
    const token = await requireToken();
    let response: Response;
    try {
      response = await fetch(KEYS_ENDPOINT(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ alg }),
      });
    } catch (cause) {
      throw new SyncError('SERVER', 'Network failure during replica-keys create', { cause });
    }
    if (!response.ok) {
      const body = await parseErrorBody(response);
      const code = body.code ?? statusToDefaultCode(response.status);
      throw new SyncError(
        code,
        body.error ?? `replica-keys create failed with status ${response.status}`,
        { status: response.status },
      );
    }
    const data = (await response.json()) as { row: ReplicaKeyRow };
    if (!data.row) {
      throw new SyncError('SERVER', 'replica-keys create returned no row');
    }
    // Splice the new salt into the cache so the next listReplicaKeys
    // call sees it without another round trip. Newest first, matching the
    // server's ORDER BY created_at DESC — CryptoSession reads rows[0] as the
    // active salt, so appending here would hand it the oldest one. Old salts
    // stay in the list: envelopes still under them must remain decryptable.
    if (this.replicaKeysCache !== null) {
      this.replicaKeysCache = [data.row, ...this.replicaKeysCache];
    }
    return data.row;
  }
}

export const replicaSyncClient = new ReplicaSyncClient();
