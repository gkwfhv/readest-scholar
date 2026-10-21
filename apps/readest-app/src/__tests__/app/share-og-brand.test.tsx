// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const capture = vi.hoisted(() => ({ element: null as unknown }));
vi.mock('next/og', () => ({
  ImageResponse: class extends Response {
    constructor(element: unknown) {
      super('image');
      capture.element = element;
    }
  },
}));
vi.mock('@/libs/shareServer', () => ({
  resolveActiveShare: vi.fn().mockResolvedValue({
    ok: true,
    share: { bookTitle: 'Synthetic paper', bookAuthor: null, coverFileKey: null },
  }),
}));
vi.mock('@/utils/object', () => ({ getDownloadSignedUrl: vi.fn() }));

import { renderShareOgImage } from '@/app/api/share/[token]/og.png/render';

afterEach(() => {
  capture.element = null;
  vi.unstubAllEnvs();
});

describe('share preview card', () => {
  it('shows the Scholar brand and configured host on a Scholar release', async () => {
    vi.stubEnv('SCHOLAR_RELEASE', 'true');
    vi.stubEnv('SITE_URL', 'https://scholar.example.test');
    await renderShareOgImage('synthetic');
    const html = renderToStaticMarkup(capture.element as React.ReactElement);
    expect(html).toContain('Shared via Readest Scholar');
    expect(html).toContain('scholar.example.test');
    expect(html).not.toContain('readest.com');
  });

  it('keeps the upstream Readest card unchanged', async () => {
    vi.stubEnv('SCHOLAR_RELEASE', 'false');
    await renderShareOgImage('synthetic');
    const html = renderToStaticMarkup(capture.element as React.ReactElement);
    expect(html).toContain('Shared via Readest');
    expect(html).toContain('readest.com');
  });
});
