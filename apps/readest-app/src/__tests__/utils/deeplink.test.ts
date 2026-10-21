import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  buildAnnotationUrl,
  parseAnnotationDeepLink,
  parseBookDeepLink,
  parseWidgetEditShelfDeepLink,
  parseWidgetGroupDeepLink,
} from '../../utils/deeplink';

afterEach(() => vi.unstubAllEnvs());

describe('buildAnnotationUrl', () => {
  const link = { bookHash: 'abc', noteId: 'n1', cfi: '/6/4!/4/2' };

  it('builds the custom-scheme app URL when linkType is "app"', () => {
    const url = buildAnnotationUrl(link, 'app');
    expect(url.startsWith('readest://book/abc/annotation/n1')).toBe(true);
  });

  it('builds the HTTPS web URL when linkType is "web"', () => {
    const url = buildAnnotationUrl(link, 'web');
    expect(url.startsWith('https://')).toBe(true);
    expect(url).toContain('/o/book/abc/annotation/n1');
  });

  it('preserves the cfi query for both link types', () => {
    const encoded = encodeURIComponent(link.cfi);
    expect(buildAnnotationUrl(link, 'app')).toContain(`cfi=${encoded}`);
    expect(buildAnnotationUrl(link, 'web')).toContain(`cfi=${encoded}`);
  });

  it('omits the cfi query when no cfi is provided', () => {
    const url = buildAnnotationUrl({ bookHash: 'abc', noteId: 'n1' }, 'app');
    expect(url).toBe('readest://book/abc/annotation/n1');
  });

  it('uses the registered Scholar scheme in a formal bundle', () => {
    vi.stubEnv('NEXT_PUBLIC_SCHOLAR_RELEASE', 'true');
    expect(buildAnnotationUrl(link, 'app')).toContain('readest-scholar://book/abc/annotation/n1');
    vi.unstubAllEnvs();
  });

  it('uses the Scholar self-hosted web origin for exported annotation links', () => {
    vi.stubEnv('NEXT_PUBLIC_SCHOLAR_RELEASE', 'true');
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://scholar.example.test');
    const url = buildAnnotationUrl(link, 'web');
    expect(url).toBe('https://scholar.example.test/o/book/abc/annotation/n1?cfi=%2F6%2F4!%2F4%2F2');
    expect(parseAnnotationDeepLink(url)).toEqual(link);
    expect(parseBookDeepLink('https://scholar.example.test/o/book/abc')).toEqual({
      bookHash: 'abc',
    });
    expect(
      parseAnnotationDeepLink('https://evil.example.test/o/book/abc/annotation/n1'),
    ).toBeNull();
  });
});

describe('widget group deep link', () => {
  it('accepts the Scholar scheme', () => {
    expect(parseWidgetGroupDeepLink('readest-scholar://widget-group/series/a1b2')).toEqual({
      groupBy: 'series',
      groupId: 'a1b2',
    });
  });
  it('parses a group link into its axis and decoded group id', () => {
    expect(parseWidgetGroupDeepLink('readest://widget-group/series/a1b2%20c3')).toEqual({
      groupBy: 'series',
      groupId: 'a1b2 c3',
    });
    expect(parseWidgetGroupDeepLink('readest://widget-group/series')).toBeNull();
    // Malformed percent-encoding is rejected, not thrown.
    expect(parseWidgetGroupDeepLink('readest://widget-group/series/a%')).toBeNull();
  });

  it('only accepts the readest:// scheme, never the web host', () => {
    expect(parseWidgetGroupDeepLink('https://web.readest.com/o/widget-group/series/x')).toBeNull();
  });
});

describe('widget edit-shelf deep link', () => {
  it('parses the decoded shelf id', () => {
    expect(parseWidgetEditShelfDeepLink('readest://widget-edit-shelf/a1b2%20c3')).toEqual({
      shelfId: 'a1b2 c3',
    });
    expect(parseWidgetEditShelfDeepLink('readest://widget-edit-shelf/')).toBeNull();
    // Malformed percent-encoding is rejected, not thrown.
    expect(parseWidgetEditShelfDeepLink('readest://widget-edit-shelf/a%')).toBeNull();
  });

  it('only accepts the readest:// scheme, never the web host', () => {
    expect(
      parseWidgetEditShelfDeepLink('https://web.readest.com/o/widget-edit-shelf/x'),
    ).toBeNull();
  });
});
