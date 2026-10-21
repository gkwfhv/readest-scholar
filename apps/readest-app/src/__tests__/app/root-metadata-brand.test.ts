import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('root metadata branding', () => {
  it('uses Scholar identity without an upstream canonical origin in the Scholar build', async () => {
    vi.stubEnv('NEXT_PUBLIC_SCHOLAR_RELEASE', 'true');
    const { metadata } = await import('@/app/layout');

    expect(metadata.title).toEqual({
      default: 'Readest Scholar',
      template: '%s | Readest Scholar',
    });
    expect(metadata.metadataBase).toBeUndefined();
    expect(metadata.manifest).toBe('/scholar-manifest.json');
    const manifest = JSON.parse(
      await readFile(join(process.cwd(), 'public/scholar-manifest.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({ name: 'Readest Scholar', short_name: 'Scholar' });
    expect(metadata.openGraph).toMatchObject({ title: 'Readest Scholar' });
    expect(metadata.openGraph).not.toHaveProperty('url');
    expect(metadata.openGraph).not.toHaveProperty('images');
    expect(metadata.other).not.toHaveProperty('twitter:url');
  });

  it('preserves upstream metadata in a regular Readest build', async () => {
    vi.stubEnv('NEXT_PUBLIC_SCHOLAR_RELEASE', 'false');
    const { metadata } = await import('@/app/layout');

    expect(metadata.title).toEqual({
      default: 'Readest — Where You Read, Digest and Get Insight',
      template: '%s | Readest',
    });
    expect(metadata.manifest).toBe('/manifest.json');
    expect(metadata.openGraph).toMatchObject({
      url: 'https://web.readest.com/',
      title: 'Readest — Where You Read, Digest and Get Insight',
    });
    expect(metadata.other).toMatchObject({ 'twitter:url': 'https://web.readest.com/' });
  });
});
