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
vi.mock('@/utils/storage', () => ({ getStorageType: vi.fn(() => 'r2') }));
vi.mock('@/utils/s3', () => ({ s3Storage: { getClient: vi.fn() } }));

import { renderShareOgImage } from '@/app/api/share/[token]/og.png/render';
import { getDownloadSignedUrl } from '@/utils/object';
import { getStorageType } from '@/utils/storage';
import { s3Storage } from '@/utils/s3';

afterEach(() => {
  state.cover = false;
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.mocked(getStorageType).mockReturnValue('r2');
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

  it('reads a self-hosted S3 cover through the internal endpoint', async () => {
    state.cover = true;
    vi.stubEnv('SCHOLAR_RELEASE', 'true');
    vi.stubEnv('SITE_URL', 'https://scholar.example.test');
    vi.stubEnv('S3_BUCKET_NAME', 'readest-files');
    vi.mocked(getStorageType).mockReturnValue('s3');
    const cover = readFileSync(new URL('../../../public/icon-tiny.png', import.meta.url));
    const send = vi.fn().mockResolvedValue({
      Body: { transformToByteArray: vi.fn().mockResolvedValue(cover) },
      ContentType: 'image/png',
    });
    vi.mocked(s3Storage.getClient).mockReturnValue({ send } as never);
    vi.mocked(getDownloadSignedUrl).mockRejectedValue(new Error('public loopback is unreachable'));

    const response = await renderShareOgImage('synthetic');
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].input).toEqual({
      Bucket: 'readest-files',
      Key: 'synthetic.png',
    });
    expect(getDownloadSignedUrl).not.toHaveBeenCalled();
  });

  it('keeps the text preview when the internal S3 object is unavailable', async () => {
    state.cover = true;
    vi.stubEnv('SCHOLAR_RELEASE', 'true');
    vi.stubEnv('SITE_URL', 'https://scholar.example.test');
    vi.mocked(getStorageType).mockReturnValue('s3');
    const send = vi.fn().mockRejectedValue(new Error('object unavailable'));
    vi.mocked(s3Storage.getClient).mockReturnValue({ send } as never);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await renderShareOgImage('synthetic');
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(log).toHaveBeenCalledOnce();
      expect(getDownloadSignedUrl).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
