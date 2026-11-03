import { describe, expect, it } from 'vitest';

import { highlightCode } from '@/utils/highlight';

describe('highlightCode', () => {
  it('highlights C++ into hljs token spans', () => {
    const html = highlightCode('int main() { return 0; }', 'cpp');
    expect(html).toBeTruthy();
    expect(html).toContain('<span class="hljs-');
  });

  it('maps common markdown aliases', () => {
    expect(highlightCode('int x = 1;', 'c++')).toContain('hljs-');
    expect(highlightCode('const x = 1;', 'js')).toContain('hljs-');
    expect(highlightCode('const x: number = 1;', 'ts')).toContain('hljs-');
  });

  it('returns null for an unknown or missing language', () => {
    expect(highlightCode('foo bar', 'not-a-language')).toBeNull();
    expect(highlightCode('foo bar')).toBeNull();
  });

  it('escapes markup in the source instead of injecting it', () => {
    const html = highlightCode('<script>alert(1)</script>', 'xml');
    expect(html).toBeTruthy();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
  });
});
