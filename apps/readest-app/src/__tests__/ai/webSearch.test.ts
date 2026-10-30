import { describe, it, expect } from 'vitest';
import { parseDdgHtml } from '@/services/ai/webSearch';

describe('parseDdgHtml', () => {
  it('extracts titles, unwrapped URLs and snippets from DDG HTML', () => {
    const html = `
      <div class="result results_links results_links_deep web-result">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=abc">Example <b>Title</b></a>
        <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage">A &amp; B <b>snippet</b> here</a>
      </div>`;

    expect(parseDdgHtml(html)).toEqual([
      {
        title: 'Example Title',
        url: 'https://example.com/page',
        snippet: 'A & B snippet here',
      },
    ]);
  });

  it('returns an empty list for markup without results', () => {
    expect(parseDdgHtml('<html><body>no results</body></html>')).toEqual([]);
  });

  it('caps the number of results', () => {
    const entry = (i: number) => `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F${i}">Result ${i}</a>
      <a class="result__snippet">Snippet ${i}</a>`;
    const html = Array.from({ length: 10 }, (_, i) => entry(i + 1)).join('');

    const results = parseDdgHtml(html, 3);
    expect(results).toHaveLength(3);
    expect(results[0]!.title).toBe('Result 1');
    expect(results[2]!.url).toBe('https://example.com/3');
  });
});
