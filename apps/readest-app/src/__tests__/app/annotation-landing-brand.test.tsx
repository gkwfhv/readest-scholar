// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ valid: true, locale: 'en' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () =>
    new URLSearchParams(state.valid ? { book: 'synthetic', note: 'annotation' } : {}),
  usePathname: () => '/o',
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => {
    if (state.locale !== 'zh') return key;
    const translated: Record<string, string> = {
      'Open in Readest': '在 Readest 中打开',
      'Open in Readest app': '在 Readest 应用中打开',
      'Opening Readest...': '正在打开 Readest…',
      'Go to Readest': '前往 Readest',
    };
    return translated[key] ?? key;
  },
}));
vi.mock('next/image', () => ({
  default: ({
    priority: _priority,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => (
    <img {...props} alt={props.alt ?? ''} />
  ),
}));

import Page from '@/app/o/page';

afterEach(() => {
  state.valid = true;
  state.locale = 'en';
  vi.unstubAllEnvs();
});

describe('annotation landing brand', () => {
  it('uses Scholar copy and the self-hosted fallback on a Scholar release', () => {
    vi.stubEnv('SCHOLAR_RELEASE', 'true');
    vi.stubEnv('SITE_URL', 'https://scholar.example.test');
    const valid = renderToStaticMarkup(<Page />);
    expect(valid).toContain('Open in Readest Scholar');
    expect(valid).toContain('Open in Readest Scholar app');
    expect(valid).not.toContain('Opening Readest...');

    state.valid = false;
    const invalid = renderToStaticMarkup(<Page />);
    expect(invalid).toContain('href="https://scholar.example.test"');
    expect(invalid).toContain('Go to Readest Scholar');
  });

  it('keeps upstream Readest copy', () => {
    vi.stubEnv('SCHOLAR_RELEASE', 'false');
    const html = renderToStaticMarkup(<Page />);
    expect(html).toContain('Open in Readest app');
    expect(html).not.toContain('Readest Scholar');
  });

  it('keeps existing Chinese translations when inserting the Scholar name', () => {
    state.locale = 'zh';
    vi.stubEnv('SCHOLAR_RELEASE', 'true');
    vi.stubEnv('SITE_URL', 'https://scholar.example.test');
    const valid = renderToStaticMarkup(<Page />);
    expect(valid).toContain('在 Readest Scholar 中打开');
    expect(valid).toContain('在 Readest Scholar 应用中打开');
    expect(valid).toContain('正在打开 Readest Scholar');

    state.valid = false;
    const invalid = renderToStaticMarkup(<Page />);
    expect(invalid).toContain('前往 Readest Scholar');
  });
});
