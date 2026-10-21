import { AppService } from '@/types/system';
import { READEST_NODE_BASE_URL, READEST_WEB_BASE_URL } from './constants';
import { getRuntimeConfig } from './runtimeConfig';
import { getOSPlatform } from '@/utils/misc';

declare global {
  interface Window {
    __READEST_CLI_ACCESS?: boolean;
    __READEST_SCHOLAR_TEST_BUNDLE?: boolean;
    __READEST_SCHOLAR_RELEASE_BUNDLE?: boolean;
  }
}

export const isTauriAppPlatform = () => process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri';
export const isWebAppPlatform = () => process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'web';
export const hasCli = () => window.__READEST_CLI_ACCESS === true;
export const isScholarTestBundle = () =>
  typeof window !== 'undefined' && window.__READEST_SCHOLAR_TEST_BUNDLE === true;
export const isScholarReleaseBundle = () =>
  process.env['NEXT_PUBLIC_SCHOLAR_RELEASE'] === 'true' ||
  getRuntimeConfig()?.scholarRelease === true ||
  (typeof window !== 'undefined' && window.__READEST_SCHOLAR_RELEASE_BUNDLE === true);
export const getAppDisplayName = () => (isScholarReleaseBundle() ? 'Readest Scholar' : 'Readest');
export const getAppDeepLinkScheme = () =>
  isScholarReleaseBundle() ? 'readest-scholar' : 'readest';
export const isAppDeepLinkProtocol = (protocol: string) =>
  protocol === 'readest:' || protocol === 'readest-scholar:';
export const getAboutAppLabel = (aboutReadest: string) =>
  aboutReadest.replace('Readest', getAppDisplayName());
export const isPWA = () => window.matchMedia('(display-mode: standalone)').matches;
export const getBaseUrl = () =>
  getRuntimeConfig()?.apiBaseUrl ??
  process.env['API_BASE_URL'] ??
  process.env['NEXT_PUBLIC_API_BASE_URL'] ??
  READEST_WEB_BASE_URL;
export const getPublicWebBaseUrl = () => {
  const runtime = getRuntimeConfig();
  const selfHosted =
    isScholarReleaseBundle() ||
    runtime?.selfHosted === true ||
    process.env['NEXT_PUBLIC_SELF_HOSTED'] === 'true' ||
    process.env['SELF_HOSTED'] === 'true';
  if (!selfHosted) return READEST_WEB_BASE_URL;

  // SITE_URL is the server's canonical public origin. The desktop bundle has
  // no server runtime config and uses its explicitly supplied web API origin.
  const raw =
    typeof window === 'undefined'
      ? process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri'
        ? process.env['NEXT_PUBLIC_API_BASE_URL']
        : (process.env['SITE_URL'] ??
          process.env['API_BASE_URL'] ??
          process.env['NEXT_PUBLIC_API_BASE_URL'])
      : runtime?.selfHosted && runtime.apiBaseUrl
        ? runtime.apiBaseUrl
        : (process.env['NEXT_PUBLIC_API_BASE_URL'] ?? runtime?.apiBaseUrl);
  let url: URL;
  try {
    url = new URL(raw ?? '');
  } catch {
    throw new Error('Self-hosted public web URL is not configured');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    /(^|\.)readest\.com$/i.test(url.hostname)
  ) {
    throw new Error('Self-hosted public web URL must be a separate HTTP(S) origin');
  }
  return url.origin;
};
export const getShareBaseUrl = () => `${getPublicWebBaseUrl()}/s`;
export const isKnownWebAppOrigin = (url: URL) =>
  url.host === new URL(READEST_WEB_BASE_URL).host || url.origin === getPublicWebBaseUrl();
export const getNodeBaseUrl = () =>
  process.env['NEXT_PUBLIC_NODE_BASE_URL'] ?? READEST_NODE_BASE_URL;

/**
 * Whether window move/resize has to be driven from JS with pointer events.
 * Linux runs on CEF, where the mouse press is owned by Chromium's X
 * connection: the runtime's `startDragging` (`_NET_WM_MOVERESIZE` from winit's
 * connection) is refused by the window manager, and the undecorated window has
 * no native resize borders either. Every other platform keeps the runtime's
 * own drag.
 */
export const needsPointerWindowControls = () =>
  isTauriAppPlatform() && typeof navigator !== 'undefined' && getOSPlatform() === 'linux';

export const isMacPlatform = () =>
  typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const getCommandPaletteShortcut = () => (isMacPlatform() ? '⌘⇧P' : 'Ctrl+Shift+P');

const isWebDevMode = () => process.env['NODE_ENV'] === 'development' && isWebAppPlatform();

// Dev API only in development mode and web platform
// with command `pnpm dev-web`
// for production build or tauri app use the production Web API
export const getAPIBaseUrl = () => (isWebDevMode() ? '/api' : `${getBaseUrl()}/api`);

// Readest Voice synthesizes on the production GPU service, which a local dev
// server cannot reach: its routes use the production Web API even under
// `pnpm dev-web` (a self-hosted apiBaseUrl still applies).
export const getReadestVoiceAPIBaseUrl = () => `${getBaseUrl()}/api`;

// For Node.js API that currently not supported in some edge runtimes
export const getNodeAPIBaseUrl = () => (isWebDevMode() ? '/api' : `${getNodeBaseUrl()}/api`);

export interface EnvConfigType {
  getAppService: () => Promise<AppService>;
}

let nativeAppService: AppService | null = null;
const getNativeAppService = async () => {
  if (!nativeAppService) {
    const { NativeAppService } = await import('@/services/nativeAppService');
    // Publish the singleton only after `init` resolves. Assigning first meant a
    // failed init left a half-built service cached forever: every later caller
    // got it back without re-running init, and `getInitializedAppService`
    // handed synchronous callers an object whose paths were never resolved.
    const service = new NativeAppService();
    await service.init();
    nativeAppService = service;
  }
  return nativeAppService;
};

let webAppService: AppService | null = null;
const getWebAppService = async () => {
  if (!webAppService) {
    const { WebAppService } = await import('@/services/webAppService');
    const service = new WebAppService();
    await service.init();
    webAppService = service;
  }
  return webAppService;
};

const environmentConfig: EnvConfigType = {
  getAppService: async () => {
    if (isTauriAppPlatform()) {
      return getNativeAppService();
    } else {
      return getWebAppService();
    }
  },
};

/**
 * Synchronously returns the app service if it has already been created by
 * {@link environmentConfig.getAppService}; null before first init. The async
 * getter is preferred everywhere — use this only from synchronous code paths
 * that run well after startup (e.g. capability checks during reader render),
 * where the singleton is guaranteed to exist.
 */
export const getInitializedAppService = (): AppService | null => nativeAppService ?? webAppService;

export default environmentConfig;
