import type { AISettings } from './types';
import type { AiCredentialField } from './nativeCredentials';

const URL = '/api/scholar/ai/credentials';

/** Browser keys are kept in memory; durable copies live encrypted on the authenticated server. */
export async function loadWebAiCredentials(
  token: string,
): Promise<Pick<AISettings, AiCredentialField>> {
  if (!token) throw new Error('Sign in to load AI credentials');
  const response = await fetch(URL, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('AI credential vault could not load keys');
  const payload = (await response.json()) as Record<string, unknown>;
  return {
    ...(typeof payload['aiGatewayApiKey'] === 'string'
      ? { aiGatewayApiKey: payload['aiGatewayApiKey'] }
      : {}),
    ...(typeof payload['openrouterApiKey'] === 'string'
      ? { openrouterApiKey: payload['openrouterApiKey'] }
      : {}),
  };
}

export async function saveWebAiCredential(
  token: string,
  field: AiCredentialField,
  value: string,
): Promise<void> {
  if (!token) throw new Error('Sign in to save AI credentials');
  const response = await fetch(URL, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: field, value }),
  });
  if (!response.ok) throw new Error('AI credential vault could not save this key');
}
