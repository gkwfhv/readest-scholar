import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebAppService } from '@/services/webAppService';

afterEach(() => vi.unstubAllGlobals());

describe('Web file copy durability', () => {
  it('does not report success before the IndexedDB write transaction commits', async () => {
    const getRequest: Record<string, unknown> = { result: { content: new Uint8Array([1, 2, 3]) } };
    const store = { get: vi.fn(() => getRequest), put: vi.fn() };
    const transaction: Record<string, unknown> = {
      objectStore: vi.fn(() => store),
      error: new Error('write aborted'),
    };
    const db = { transaction: vi.fn(() => transaction) };
    const openRequest: Record<string, unknown> = { result: db };
    vi.stubGlobal('indexedDB', { open: vi.fn(() => openRequest) });

    const service = new WebAppService();
    const copy = service.copyFile('source.pdf', 'Books', 'snapshot.pdf', 'Cache');
    await vi.waitFor(() => expect(openRequest['onsuccess']).toBeTypeOf('function'));
    (openRequest['onsuccess'] as () => void)();
    await vi.waitFor(() => expect(getRequest['onsuccess']).toBeTypeOf('function'));
    (getRequest['onsuccess'] as () => void)();
    expect(store.put).toHaveBeenCalledOnce();

    let settled = false;
    void copy.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    (transaction['onerror'] as () => void)();
    await expect(copy).rejects.toThrow('write aborted');
  });
});
