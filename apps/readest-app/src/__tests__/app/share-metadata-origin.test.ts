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
});
