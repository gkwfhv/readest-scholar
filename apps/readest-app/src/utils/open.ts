import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauriAppPlatform } from '@/services/environment';

/**
 * Open an external URL in the system browser. On Tauri the in-app webview
 * ignores `target="_blank"`, so route through the opener plugin; on web fall
 * back to `window.open`. Unlike `interceptWindowOpen`, this works without the
 * reader-scoped `window.open` override being installed.
 */
export const openExternalUrl = (url: string) => {
  if (isTauriAppPlatform()) {
    void openUrl(url).catch((err) => console.warn('Failed to open external URL', url, err));
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

const EXTERNAL_URL = /^(https?:|mailto:)/i;

/**
 * Click handler for rendered markdown links: send external URLs to the system
 * browser and stop the webview from navigating to (or opening an in-app window
 * for) the page. Relative/anchor/invalid links keep their default behaviour.
 */
export const openExternalLink = (
  event: { preventDefault: () => void; stopPropagation: () => void },
  href?: string | null,
) => {
  if (!href || !EXTERNAL_URL.test(href)) return;
  event.preventDefault();
  event.stopPropagation();
  openExternalUrl(href);
};

export const interceptWindowOpen = () => {
  const windowOpen = window.open;
  globalThis.open = function (
    url?: string | URL,
    target?: string,
    features?: string,
  ): Window | null {
    if (isTauriAppPlatform()) {
      openUrl(url?.toString() || '');
      return null;
    } else {
      return windowOpen(url, target, features);
    }
  };
};
