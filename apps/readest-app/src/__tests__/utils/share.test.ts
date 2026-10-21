import { afterEach, describe, it, expect, vi } from 'vitest';
import { buildShareUrl, parseShareDeepLink } from '@/utils/share';

afterEach(() => vi.unstubAllEnvs());

describe('buildShareUrl', () => {
  it('builds the canonical https URL for a token', () => {
    expect(buildShareUrl('aBcDeFgHiJkLmNoPqRsTuV')).toBe(
      'https://web.readest.com/s/aBcDeFgHiJkLmNoPqRsTuV',
    );
  });

  it('builds and accepts a Scholar self-hosted share URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SCHOLAR_RELEASE', 'true');
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://scholar.example.test');
    const token = 'aBcDeFgHiJkLmNoPqRsTuV';
    const url = buildShareUrl(token);
    expect(url).toBe(`https://scholar.example.test/s/${token}`);
    expect(parseShareDeepLink(url)).toEqual({ token });
    expect(parseShareDeepLink(`https://evil.example.test/s/${token}`)).toBeNull();
    expect(parseShareDeepLink(`http://scholar.example.test/s/${token}`)).toBeNull();
  });
});

describe('parseShareDeepLink', () => {
  const VALID_TOKEN = 'aBcDeFgHiJkLmNoPqRsTuV';

  it('parses readest://share/{token}', () => {
    expect(parseShareDeepLink(`readest://share/${VALID_TOKEN}`)).toEqual({ token: VALID_TOKEN });
    expect(parseShareDeepLink(`readest-scholar://share/${VALID_TOKEN}`)).toEqual({
      token: VALID_TOKEN,
    });
  });

  it('parses https://web.readest.com/s/{token}', () => {
    expect(parseShareDeepLink(`https://web.readest.com/s/${VALID_TOKEN}`)).toEqual({
      token: VALID_TOKEN,
    });
  });

  it('parses *.readest.com subdomains for preview deploys', () => {
    expect(parseShareDeepLink(`https://staging.readest.com/s/${VALID_TOKEN}`)).toEqual({
      token: VALID_TOKEN,
    });
  });

  it('rejects tokens of the wrong length', () => {
    expect(parseShareDeepLink('readest://share/short')).toBeNull();
    expect(parseShareDeepLink(`readest://share/${VALID_TOKEN}extra`)).toBeNull();
  });

  it('rejects tokens with disallowed characters', () => {
    // Underscore and hyphen are explicitly NOT in the alphabet.
    const bad = 'aBcDeFgHiJkLmNoPqRsTu-';
    expect(parseShareDeepLink(`readest://share/${bad}`)).toBeNull();
  });

  it('rejects URLs from third-party hosts', () => {
    expect(parseShareDeepLink(`https://evil.example.com/s/${VALID_TOKEN}`)).toBeNull();
  });

  it('rejects readest:// URLs whose host is not "share"', () => {
    expect(parseShareDeepLink(`readest://book/${VALID_TOKEN}`)).toBeNull();
    expect(parseShareDeepLink(`readest://annotation/${VALID_TOKEN}`)).toBeNull();
  });

  it('rejects nested or extra path segments', () => {
    expect(parseShareDeepLink(`https://web.readest.com/s/${VALID_TOKEN}/extra`)).toBeNull();
    expect(parseShareDeepLink(`https://web.readest.com/extra/s/${VALID_TOKEN}`)).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseShareDeepLink('')).toBeNull();
    expect(parseShareDeepLink('not-a-url')).toBeNull();
    expect(parseShareDeepLink('ftp://web.readest.com/s/' + VALID_TOKEN)).toBeNull();
  });
});
