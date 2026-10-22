import { describe, expect, test } from 'vitest';
import { formatChangePage, validateChangePullParams } from '@/libs/replicaChangeProtocol';

describe('replica change pull protocol', () => {
  test('validates kind, decimal bigint cursor, and bounded page size', () => {
    expect(validateChangePullParams('dictionary', null, null)).toEqual({
      ok: true,
      params: { kind: 'dictionary', after: '0', limit: 100 },
    });
    expect(validateChangePullParams('dictionary', '9007199254740993', '1000')).toEqual({
      ok: true,
      params: { kind: 'dictionary', after: '9007199254740993', limit: 1000 },
    });
    for (const after of ['-1', '01', '1.5', '9e3', '9223372036854775808']) {
      expect(validateChangePullParams('dictionary', after, null).ok).toBe(false);
    }
    for (const limit of ['0', '1001', '1.5', '01']) {
      expect(validateChangePullParams('dictionary', null, limit).ok).toBe(false);
    }
    expect(validateChangePullParams('unknown-kind', null, null).ok).toBe(false);
  });

  test('uses exact sequence strings and carries a page boundary forward', () => {
    const rows = [
      { seq: '9007199254740993', row_data: { replica_id: 'a' } },
      { seq: '9007199254740994', row_data: { replica_id: 'b' } },
    ];
    expect(formatChangePage(rows, '9007199254740992', 1)).toEqual({
      changes: [{ seq: '9007199254740993', row: { replica_id: 'a' } }],
      nextCursor: '9007199254740993',
      hasMore: true,
    });
    expect(formatChangePage([], '9007199254740993', 1)).toEqual({
      changes: [],
      nextCursor: '9007199254740993',
      hasMore: false,
    });
  });
});
