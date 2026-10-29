import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('macOS self-hosted WebView network policy', () => {
  it('allows operator-controlled HTTP services only from WebKit content', () => {
    const infoPlist = readFileSync(resolve(process.cwd(), 'src-tauri/Info.plist'), 'utf8');

    expect(infoPlist).toMatch(
      /<key>NSAppTransportSecurity<\/key>\s*<dict>\s*<key>NSAllowsArbitraryLoadsInWebContent<\/key>\s*<true\/>/,
    );
    expect(infoPlist).not.toContain('<key>NSAllowsArbitraryLoads</key>');
  });
});
