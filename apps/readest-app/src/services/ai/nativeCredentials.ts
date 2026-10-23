import { isTauriAppPlatform } from '@/services/environment';
import type { SystemSettings } from '@/types/settings';
import { clearSecureItem, getSecureItem, setSecureItem } from '@/utils/bridge';
import { aiUserScope } from './accountScope';
import type { AISettings } from './types';

export const LEGACY_AI_CREDENTIAL_NOTICE_KEY = 'scholar-ai-legacy-key-reentry:v1';

export type AiCredentialField = 'aiGatewayApiKey' | 'openrouterApiKey';
const FIELDS: readonly AiCredentialField[] = ['aiGatewayApiKey', 'openrouterApiKey'];

export function currentAiCredentialScope(): string {
  if (typeof localStorage === 'undefined') return aiUserScope(null);
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null') as { id?: unknown } | null;
    return aiUserScope(typeof user?.id === 'string' ? user.id : null);
  } catch {
    return aiUserScope(null);
  }
}

function credentialKey(userId: string | null, field: AiCredentialField): string {
  return `scholar-ai-credential:v1:${aiUserScope(userId)}:${field}`;
}

/** Never send secret fields into settings.json, its backup, or settings broadcasts. */
export function withoutAiCredentials(settings: SystemSettings): SystemSettings {
  const aiSettings = { ...settings.aiSettings };
  for (const field of FIELDS) delete aiSettings[field];
  delete aiSettings.credentialScope;
  return { ...settings, aiSettings };
}

/** The native bridge stores these values in the OS keychain, scoped to the active account. */
export async function loadNativeAiCredentials(
  userId: string | null,
): Promise<Pick<AISettings, AiCredentialField>> {
  if (!isTauriAppPlatform()) return {};
  const credentials: Partial<Pick<AISettings, AiCredentialField>> = {};
  for (const field of FIELDS) {
    const result = await getSecureItem({ key: credentialKey(userId, field) });
    if (result.error) throw new Error(`OS keychain could not read the ${field} credential`);
    if (result.value) credentials[field] = result.value;
  }
  return credentials;
}

export async function saveNativeAiCredential(
  userId: string | null,
  field: AiCredentialField,
  value: string,
): Promise<void> {
  if (!isTauriAppPlatform()) throw new Error('Native AI credentials require the desktop app');
  const key = credentialKey(userId, field);
  const result = value ? await setSecureItem({ key, value }) : await clearSecureItem({ key });
  if (!result.success) {
    throw new Error(`OS keychain rejected the ${field} credential`);
  }
}
