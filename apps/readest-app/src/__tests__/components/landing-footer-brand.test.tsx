// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageFooter } from '@/components/landing/PageFooter';

afterEach(() => vi.unstubAllEnvs());

describe('landing footer brand', () => {
  it('links Scholar landing pages to the configured self-hosted origin', () => {
    vi.stubEnv('SCHOLAR_RELEASE', 'true');
    vi.stubEnv('SITE_URL', 'https://scholar.example.test');
    const html = renderToStaticMarkup(<PageFooter tagline='Reader' />);
    expect(html).toContain('href="https://scholar.example.test"');
    expect(html).toContain('Readest Scholar');
    expect(html).not.toContain('href="https://readest.com"');
  });

  it('preserves the upstream footer', () => {
    vi.stubEnv('SCHOLAR_RELEASE', 'false');
    vi.stubEnv('SELF_HOSTED', 'false');
    const html = renderToStaticMarkup(<PageFooter tagline='Reader' />);
    expect(html).toContain('href="https://readest.com"');
    expect(html).toContain('>Readest</a>');
  });
});
