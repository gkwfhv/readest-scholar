// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const state = vi.hoisted(() => ({ cover: false }));

vi.mock('@/libs/shareServer', () => ({
  resolveActiveShare: vi.fn().mockResolvedValue({
    ok: true,
    share: {
      bookTitle: 'Synthetic paper',
      bookAuthor: null,
      get coverFileKey() {
        return state.cover ? 'synthetic.png' : null;
      },
    },
  }),
}));
vi.mock('@/utils/object', () => ({ getDownloadSignedUrl: vi.fn() }));

import { renderShareOgImage } from '@/app/api/share/[token]/og.png/render';
import { getDownloadSignedUrl } from '@/utils/object';

afterEach(() => {
  state.cover = false;
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('share preview rendering', () => {
  it('streams a real PNG for the Scholar text-only fallback', async () => {
    vi.stubEnv('SCHOLAR_RELEASE', 'true');
    vi.stubEnv('SITE_URL', 'https://scholar.example.test');
    const response = await renderShareOgImage('synthetic');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.headers.get('content-type')).toContain('image/png');
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('streams a real PNG when the shared book has a cover', async () => {
    state.cover = true;
    vi.stubEnv('SCHOLAR_RELEASE', 'true');
    vi.stubEnv('SITE_URL', 'https://scholar.example.test');
    const cover = readFileSync(new URL('../../../public/icon-tiny.png', import.meta.url));
    vi.mocked(getDownloadSignedUrl).mockResolvedValue(
      `data:image/png;base64,${cover.toString('base64')}`,
    );
    const response = await renderShareOgImage('synthetic');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.headers.get('content-type')).toContain('image/png');
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('streams the text fallback when the cover URL cannot be fetched', async () => {
    state.cover = true;
    vi.stubEnv('SCHOLAR_RELEASE', 'true');
    vi.stubEnv('SITE_URL', 'https://scholar.example.test');
    vi.mocked(getDownloadSignedUrl).mockRejectedValue(new Error('cover unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await renderShareOgImage('synthetic');
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(log).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });
});
