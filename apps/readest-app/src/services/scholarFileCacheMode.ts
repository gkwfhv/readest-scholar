import { getOSPlatform } from '@/utils/misc';
/** The PDF cache preference belongs to this device and this Scholar account. */
export type ScholarFileCacheMode = 'on_demand' | 'full_mirror';
export const SCHOLAR_FILE_CACHE_MODE_EVENT = 'scholar-file-cache-mode-changed';
const prefix = 'readest_scholar_file_cache_mode_v1:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getScholarFileCacheMode(
  accountId: string | null | undefined,
): ScholarFileCacheMode {
  if (!accountId || !uuid.test(accountId) || typeof localStorage === 'undefined')
    return 'on_demand';
  try {
    return localStorage.getItem(prefix + accountId) === 'full_mirror' ? 'full_mirror' : 'on_demand';
  } catch {
    return 'on_demand';
  }
}

export function setScholarFileCacheMode(accountId: string, mode: ScholarFileCacheMode): void {
  if (!uuid.test(accountId) || !['on_demand', 'full_mirror'].includes(mode)) {
    throw new Error('Invalid Scholar file cache preference');
  }
  localStorage.setItem(prefix + accountId, mode);
  window.dispatchEvent(new CustomEvent(SCHOLAR_FILE_CACHE_MODE_EVENT, { detail: accountId }));
}

export function isScholarFileCacheModeKey(key: string | null, accountId: string): boolean {
  return key === prefix + accountId;
}

/** Mobile auto-mirroring requires positive evidence of an unmetered link.
 * iOS does not expose Network Information, so unknown mobile links remain
 * on-demand. Desktop links are allowed unless data saver is enabled. */
type ScholarNetworkInfo = EventTarget & { type?: string; saveData?: boolean };
export function getScholarMirrorConnection(): ScholarNetworkInfo | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { connection?: ScholarNetworkInfo }).connection;
}

export function isScholarMirrorNetworkAllowed(isNativeMobile = false): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = getScholarMirrorConnection();
  if (connection?.saveData) return false;
  const platform = getOSPlatform();
  if (isNativeMobile || platform === 'ios' || platform === 'android') {
    return connection?.type === 'wifi' || connection?.type === 'ethernet';
  }
  return connection?.type !== 'cellular';
}
