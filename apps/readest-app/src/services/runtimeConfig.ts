export interface ReadestRuntimeConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  apiBaseUrl?: string;
  objectStorageType?: string;
  storageFixedQuota?: number;
  translationFixedQuota?: number;
  fontBaseUrl?: string;
  selfHosted?: boolean;
  scholarRelease?: boolean;
  authProviders?: string[];
}

declare global {
  interface Window {
    __READEST_RUNTIME_CONFIG?: ReadestRuntimeConfig;
  }
}

const SELF_HOSTED_RUNTIME_CONFIG_STORAGE_KEY = 'readest.self-hosted-runtime-config.v1';
const AUTH_PROVIDERS = new Set(['google', 'apple', 'github', 'discord']);

const normalizeOrigin = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
};

const parseAuthProviders = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const providers = value.filter(
    (provider): provider is string => typeof provider === 'string' && AUTH_PROVIDERS.has(provider),
  );
  return providers.length > 0 ? providers : undefined;
};

const parseRuntimeConfig = (value: unknown): ReadestRuntimeConfig | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  const supabaseUrl = normalizeOrigin(candidate['supabaseUrl']);
  const apiBaseUrl = normalizeOrigin(candidate['apiBaseUrl']);
  const supabaseAnonKey = candidate['supabaseAnonKey'];
  if (!supabaseUrl || !apiBaseUrl || typeof supabaseAnonKey !== 'string' || !supabaseAnonKey) {
    return undefined;
  }
  if (candidate['selfHosted'] !== true) return undefined;

  return {
    supabaseUrl,
    supabaseAnonKey,
    apiBaseUrl,
    objectStorageType:
      typeof candidate['objectStorageType'] === 'string'
        ? candidate['objectStorageType']
        : undefined,
    storageFixedQuota:
      typeof candidate['storageFixedQuota'] === 'number'
        ? candidate['storageFixedQuota']
        : undefined,
    translationFixedQuota:
      typeof candidate['translationFixedQuota'] === 'number'
        ? candidate['translationFixedQuota']
        : undefined,
    fontBaseUrl:
      typeof candidate['fontBaseUrl'] === 'string' ? candidate['fontBaseUrl'] : undefined,
    selfHosted: true,
    scholarRelease: candidate['scholarRelease'] === true || undefined,
    authProviders: parseAuthProviders(candidate['authProviders']),
  };
};

const getSavedSelfHostedRuntimeConfig = (): ReadestRuntimeConfig | undefined => {
  if (typeof window === 'undefined') return undefined;
  try {
    return parseRuntimeConfig(
      JSON.parse(localStorage.getItem(SELF_HOSTED_RUNTIME_CONFIG_STORAGE_KEY) || ''),
    );
  } catch {
    return undefined;
  }
};

export const getRuntimeConfig = () =>
  typeof window === 'undefined'
    ? undefined
    : (getSavedSelfHostedRuntimeConfig() ?? window.__READEST_RUNTIME_CONFIG);

export const loadSelfHostedRuntimeConfig = async (
  serverUrl: string,
): Promise<ReadestRuntimeConfig> => {
  const origin = normalizeOrigin(serverUrl);
  if (!origin) throw new Error('Enter a valid HTTP(S) server URL.');

  const response = await fetch(`${origin}/runtime-config.json`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('The server configuration could not be loaded.');

  const config = parseRuntimeConfig(await response.json());
  if (!config) throw new Error('The server did not provide a valid self-hosted configuration.');
  return config;
};

export const saveSelfHostedRuntimeConfig = (config: ReadestRuntimeConfig): void => {
  const parsed = parseRuntimeConfig(config);
  if (!parsed) throw new Error('The server did not provide a valid self-hosted configuration.');
  localStorage.setItem(SELF_HOSTED_RUNTIME_CONFIG_STORAGE_KEY, JSON.stringify(parsed));
};

export const getServerRuntimeConfig = (): ReadestRuntimeConfig => {
  const configuredProviders = process.env['AUTH_PROVIDERS']
    ?.split(',')
    .map((provider) => provider.trim())
    .filter((provider) => AUTH_PROVIDERS.has(provider));

  return {
    // Browser runtime config should prefer a public Supabase URL when provided.
    // SUPABASE_URL remains as a backward-compatible fallback for non-split setups.
    supabaseUrl:
      process.env['SUPABASE_PUBLIC_URL'] ??
      process.env['NEXT_PUBLIC_SUPABASE_URL'] ??
      process.env['SUPABASE_URL'],
    supabaseAnonKey:
      process.env['SUPABASE_ANON_KEY'] ?? process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    apiBaseUrl:
      process.env['API_BASE_URL'] ??
      process.env['NEXT_PUBLIC_API_BASE_URL'] ??
      process.env['SITE_URL'],
    // These were previously baked as NEXT_PUBLIC_* build args; now read from runtime env so
    // the published image can be configured without rebuilding.
    objectStorageType:
      process.env['OBJECT_STORAGE_TYPE'] ?? process.env['NEXT_PUBLIC_OBJECT_STORAGE_TYPE'],
    // A self-hosted deployment unlocks every premium feature: there is no store
    // to buy from, and the operator already runs the infrastructure the paywall
    // funds.
    selfHosted:
      (process.env['SELF_HOSTED'] || process.env['NEXT_PUBLIC_SELF_HOSTED']) === 'true' ||
      undefined,
    scholarRelease:
      (process.env['SCHOLAR_RELEASE'] || process.env['NEXT_PUBLIC_SCHOLAR_RELEASE']) === 'true' ||
      undefined,
    storageFixedQuota: (() => {
      const raw =
        process.env['STORAGE_FIXED_QUOTA'] ?? process.env['NEXT_PUBLIC_STORAGE_FIXED_QUOTA'];
      return raw ? parseInt(raw, 10) : undefined;
    })(),
    translationFixedQuota: (() => {
      const raw =
        process.env['TRANSLATION_FIXED_QUOTA'] ??
        process.env['NEXT_PUBLIC_TRANSLATION_FIXED_QUOTA'];
      return raw ? parseInt(raw, 10) : undefined;
    })(),
    // Base URL of the directory holding the self-hosted CJK webfont bundles.
    // Readest's own CDN only answers CORS for readest.com origins, so a
    // self-hosted deployment on a custom domain has to serve them itself (#5550).
    // `||` rather than `??`: compose passes the variable through even when it is unset,
    // and an empty string would build root-relative font URLs.
    fontBaseUrl:
      process.env['FONT_BASE_URL'] || process.env['NEXT_PUBLIC_FONT_BASE_URL'] || undefined,
    authProviders: configuredProviders?.length ? configuredProviders : undefined,
  };
};
