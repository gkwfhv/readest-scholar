// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/shareServer', () => ({
  resolveActiveShare: vi.fn().mockResolvedValue({
    ok: true,
    share: { bookTitle: 'Synthetic paper', bookAuthor: 'Example Author' },
  }),
}));

import { generateMetadata } from '@/app/s/page';

afterEach(() => vi.unstubAllEnvs());

describe('shared-book metadata', () => {
  it('uses the self-hosted origin for the share and preview image', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'web');
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('SITE_URL', 'https://scholar.example.test');
    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ token: 'synthetic' }),
    });
    expect(metadata.openGraph).toMatchObject({
      url: 'https://scholar.example.test/s/synthetic',
      images: [{ url: 'https://scholar.example.test/api/share/synthetic/og.png' }],
    });
  });

  it('brands Scholar shares without changing upstream Readest shares', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'web');
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('SITE_URL', 'https://scholar.example.test');
    vi.stubEnv('SCHOLAR_RELEASE', 'true');
    const scholar = await generateMetadata({
      searchParams: Promise.resolve({ token: 'synthetic' }),
    });
    expect(scholar.title).toBe('Synthetic paper · Shared via Readest Scholar');
    expect(scholar.description).toBe('Example Author · Shared via Readest Scholar');
    expect(scholar.openGraph).toMatchObject({
      title: 'Synthetic paper',
      description: 'Example Author · Shared via Readest Scholar',
    });

    vi.stubEnv('SCHOLAR_RELEASE', 'false');
    const upstream = await generateMetadata({
      searchParams: Promise.resolve({ token: 'synthetic' }),
    });
    expect(upstream.title).toBe('Synthetic paper · Shared via Readest');
  });
});
