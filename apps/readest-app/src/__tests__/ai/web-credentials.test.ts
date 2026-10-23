import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWebAiCredentials, saveWebAiCredential } from '@/services/ai/webCredentials';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('Web AI credential vault client', () => {
  it('reads only through an authenticated no-store request', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ openrouterApiKey: 'test-secret' }),
    } as Response);
    expect(await loadWebAiCredentials('test-token')).toEqual({ openrouterApiKey: 'test-secret' });
    expect(fetch).toHaveBeenCalledWith('/api/scholar/ai/credentials', {
      headers: { Authorization: 'Bearer test-token' },
      cache: 'no-store',
    });
  });
  it('writes a credential only to the authenticated vault', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
    await saveWebAiCredential('test-token', 'aiGatewayApiKey', 'test-secret');
    expect(fetch).toHaveBeenCalledWith('/api/scholar/ai/credentials', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'aiGatewayApiKey', value: 'test-secret' }),
    });
  });
  it('reports unavailable vault writes instead of treating them as saved', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);
    await expect(saveWebAiCredential('test-token', 'openrouterApiKey', 'x')).rejects.toThrow();
  });
});
