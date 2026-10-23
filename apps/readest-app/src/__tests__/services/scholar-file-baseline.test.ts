import { beforeEach, describe, expect, it, vi } from 'vitest';
const getAccessToken = vi.fn();
vi.mock('@/utils/access', () => ({ getAccessToken: () => getAccessToken() }));
import {
  getScholarAccountId,
  getScholarFileBaseline,
  saveScholarFileBaseline,
} from '@/services/scholarFileBaseline';
const userA = '00000000-0000-4000-8000-000000000001';
const userB = '00000000-0000-4000-8000-000000000002';
const fileId = '00000000-0000-4000-8000-000000000003';
const versionId = '00000000-0000-4000-8000-000000000004';
const cfp = 'Readest/Books/hash/paper.pdf';
beforeEach(() => {
  localStorage.clear();
  getAccessToken.mockReset();
});
describe('Scholar file baseline', () => {
  it('derives the account from the API token rather than a stale local user value', async () => {
    localStorage.setItem('user', JSON.stringify({ id: userB }));
    const payload = btoa(JSON.stringify({ sub: userA, role: 'authenticated' }));
    getAccessToken.mockResolvedValue(`eyJhbGciOiJIUzI1NiJ9.${payload}.signature`);
    expect(await getScholarAccountId()).toBe(userA);
    getAccessToken.mockResolvedValue('invalid');
    expect(await getScholarAccountId()).toBeNull();
  });
  it('persists the exact known version separately for each account', () => {
    saveScholarFileBaseline(userA, cfp, { fileId, versionId });
    expect(getScholarFileBaseline(userA, cfp)).toEqual({ fileId, versionId });
    expect(getScholarFileBaseline(userB, cfp)).toBeUndefined();
    saveScholarFileBaseline(userB, cfp, { fileId, versionId: null });
    expect(getScholarFileBaseline(userA, cfp)?.versionId).toBe(versionId);
    expect(getScholarFileBaseline(userB, cfp)?.versionId).toBeNull();
  });
  it('rejects corrupted local state instead of trusting a false baseline', () => {
    localStorage.setItem(
      `readest_scholar_file_baseline_v1:${userA}:${encodeURIComponent(cfp)}`,
      '{bad',
    );
    expect(getScholarFileBaseline(userA, cfp)).toBeUndefined();
  });
});
