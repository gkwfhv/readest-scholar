import { isAllowedKind } from '@/libs/replicaSchemas';

export const MAX_CHANGE_PAGE = 1000;
const MAX_SIGNED_BIGINT = 9223372036854775807n;
const DECIMAL = /^(0|[1-9][0-9]*)$/;

export type ChangePullValidation =
  | { ok: true; params: { kind: string; after: string; limit: number } }
  | { ok: false; status: number; code: 'VALIDATION' | 'UNKNOWN_KIND'; message: string };

export const validateChangePullParams = (
  kind: string | null,
  after: string | null,
  pageSize: string | null,
): ChangePullValidation => {
  if (!kind) {
    return { ok: false, status: 400, code: 'VALIDATION', message: 'kind query parameter required' };
  }
  if (!isAllowedKind(kind)) {
    return { ok: false, status: 422, code: 'UNKNOWN_KIND', message: 'Unknown replica kind' };
  }
  const cursor = after ?? '0';
  if (cursor.length > 19 || !DECIMAL.test(cursor) || BigInt(cursor) > MAX_SIGNED_BIGINT) {
    return { ok: false, status: 400, code: 'VALIDATION', message: 'Invalid change cursor' };
  }
  const limitText = pageSize ?? '100';
  if (!/^[1-9][0-9]*$/.test(limitText) || limitText.length > 4) {
    return { ok: false, status: 400, code: 'VALIDATION', message: 'Invalid page size' };
  }
  const limit = Number(limitText);
  if (limit > MAX_CHANGE_PAGE) {
    return { ok: false, status: 400, code: 'VALIDATION', message: 'Page size exceeds 1000' };
  }
  return { ok: true, params: { kind, after: cursor, limit } };
};

export interface ChangeRecord {
  seq: string;
  row_data: Record<string, unknown>;
}

export const formatChangePage = (records: ChangeRecord[], after: string, limit: number) => {
  const page = records.slice(0, limit);
  return {
    changes: page.map(({ seq, row_data }) => ({ seq, row: row_data })),
    nextCursor: page.at(-1)?.seq ?? after,
    hasMore: records.length > limit,
  };
};
