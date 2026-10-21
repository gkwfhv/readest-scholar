import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadSettings = vi.fn();
const setCheckOpenWithBooks = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@tauri-apps/api/window', () => ({ getAllWindows: vi.fn(), getCurrentWindow: vi.fn() }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { loadSettings, isIOSApp: false, hasWindow: false } }),
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ setCheckOpenWithBooks }),
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/nav', () => ({
  navigateToLibrary: vi.fn(),
  navigateToReader: vi.fn(),
  showLibraryWindow: vi.fn(),
}));
vi.mock('@/utils/md5', () => ({ partialMD5: vi.fn() }));

import { useOpenWithBooks } from '@/hooks/useOpenWithBooks';
import { eventDispatcher } from '@/utils/event';

beforeEach(() => {
  loadSettings.mockReset().mockResolvedValue({ autoImportBooksOnOpen: true });
  setCheckOpenWithBooks.mockReset();
});

describe('useOpenWithBooks URL routing', () => {
  it('leaves Scholar links to the deep-link consumers instead of opening them as files', async () => {
    const { unmount } = renderHook(() => useOpenWithBooks());
    await eventDispatcher.dispatch('app-incoming-url', {
      urls: ['readest-scholar://book/abc123'],
    });
    expect(loadSettings).not.toHaveBeenCalled();
    expect(setCheckOpenWithBooks).not.toHaveBeenCalled();
    unmount();
  });
});
