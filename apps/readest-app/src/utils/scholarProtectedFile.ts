import { isScholarReleaseBundle } from '@/services/environment';

/**
 * The generic storage delete endpoint removes an object before its database
 * row. It must never touch Scholar's immutable versions or main book objects:
 * versions can still be pending while the file row is being registered, so a
 * database-only preflight cannot close that race.
 */
export const isProtectedScholarStorageKey = (fileKey: string, userId: string): boolean => {
  if (!fileKey.startsWith(userId + '/')) return false;
  const relative = fileKey.slice(userId.length + 1);
  if (relative.startsWith('Scholar/versions/')) return true;
  return isScholarReleaseBundle() && /^Readest\/Books\/[^/]+\/[^/]+$/.test(relative);
};
