import { jwtDecode } from 'jwt-decode';
import { getAccessToken } from '@/utils/access';

export interface ScholarFileBaseline {
  fileId: string;
  versionId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keyFor = (userId: string, cloudFilePath: string) =>
  `readest_scholar_file_baseline_v1:${userId}:${encodeURIComponent(cloudFilePath)}`;

/** The API validates the token; this ID only scopes local queue state. */
export async function getScholarAccountId(): Promise<string | null> {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const subject = jwtDecode<{ sub?: string }>(token).sub;
    return subject && UUID.test(subject) ? subject : null;
  } catch {
    return null;
  }
}

/** A device's last verified version, scoped to its account and book file. */
export function getScholarFileBaseline(
  userId: string,
  cloudFilePath: string,
): ScholarFileBaseline | undefined {
  if (!UUID.test(userId) || typeof localStorage === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(keyFor(userId, cloudFilePath));
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== 'object' || value === null ||
      !('fileId' in value) || typeof value.fileId !== 'string' || !UUID.test(value.fileId) ||
      !('versionId' in value) ||
      !(value.versionId === null || (typeof value.versionId === 'string' && UUID.test(value.versionId)))
    ) return undefined;
    return { fileId: value.fileId, versionId: value.versionId };
  } catch {
    return undefined;
  }
}

export function saveScholarFileBaseline(
  userId: string,
  cloudFilePath: string,
  baseline: ScholarFileBaseline,
): void {
  if (
    !UUID.test(userId) || !UUID.test(baseline.fileId) ||
    !(baseline.versionId === null || UUID.test(baseline.versionId)) ||
    typeof localStorage === 'undefined'
  ) throw new Error('Invalid Scholar file baseline');
  localStorage.setItem(keyFor(userId, cloudFilePath), JSON.stringify(baseline));
}
