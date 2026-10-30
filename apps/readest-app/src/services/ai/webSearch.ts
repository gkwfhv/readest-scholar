import { isTauriAppPlatform } from '@/services/environment';
import { aiFileLog } from './fileLog';
import { getAIFetch } from './utils/httpFetch';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

// DuckDuckGo's no-JS HTML endpoint: stable markup, no API key, no rate-limit
// contract. Scraping it is the classic free search fallback.
export const DDG_ENDPOINT = 'https://html.duckduckgo.com/html/';
// Bing's SERP is server-rendered, but from a mainland-China IP it is not
// trustworthy: without an explicit market it returns a degraded page ("There
// are no results for this question") padded with unrelated filler, and even
// with one it frequently serves results for a different query entirely. The
// `mkt` parameter is still sent because it measurably improves the odds.
export const BING_ENDPOINT = 'https://www.bing.com/search';
// Baidu is the primary provider: measured on this network it answers Chinese
// and English queries alike with on-topic results and real destination URLs.
export const BAIDU_ENDPOINT = 'https://www.baidu.com/s';
// Baidu's WAF drops an IP into a minutes-long captcha cooldown after a burst
// of requests; Sogou carries its own quota, so it covers that window.
export const SOGOU_ENDPOINT = 'https://www.sogou.com/web';
export const DEFAULT_WEB_RESULTS = 6;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SEARCH_TIMEOUT_MS = 12_000;
const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

const stripHtml = (raw: string): string =>
  raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

// The HTML endpoint wraps every result link in a //duckduckgo.com/l/?uddg=
// redirect so DDG can log clicks. Unwrap it to the real destination.
function decodeDdgRedirect(href: string): string {
  try {
    const uddg = new URL(href, DDG_ENDPOINT).searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
  } catch {
    /* keep the raw href */
  }
  return href;
}

export function parseDdgHtml(html: string, maxResults = DEFAULT_WEB_RESULTS): WebSearchResult[] {
  const titles = Array.from(
    html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi),
  );
  const snippets = Array.from(
    html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi),
  );
  const results: WebSearchResult[] = [];
  for (let i = 0; i < Math.min(titles.length, maxResults); i++) {
    const href = titles[i]?.[1] ?? '';
    const title = stripHtml(titles[i]?.[2] ?? '');
    if (!title || !href) continue;
    results.push({
      title,
      url: decodeDdgRedirect(href),
      snippet: stripHtml(snippets[i]?.[1] ?? ''),
    });
  }
  return results;
}

// Bing rewrites result links through a /ck/a redirect whose `u` parameter is
// "a1" plus unpadded base64 of the real destination.
function decodeBingRedirect(href: string): string {
  try {
    const url = new URL(href.replace(/&amp;/g, '&'), BING_ENDPOINT);
    if (!url.pathname.startsWith('/ck/')) return url.href;
    const u = url.searchParams.get('u');
    if (!u) return url.href;
    const body = u.startsWith('a1') ? u.slice(2) : u;
    const padded = body + '='.repeat((4 - (body.length % 4)) % 4);
    const decoded = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    if (/^https?:\/\//.test(decoded)) return decoded;
  } catch {
    /* keep the raw href */
  }
  return href.replace(/&amp;/g, '&');
}

export function parseBingHtml(html: string, maxResults = DEFAULT_WEB_RESULTS): WebSearchResult[] {
  // The degraded SERP still ships ten `b_algo` blocks, so without this guard
  // unrelated filler (ads, trending pages) would be handed to the model as if
  // it answered the query.
  if (/There are no results for this question/i.test(html)) return [];
  const results: WebSearchResult[] = [];
  for (const block of html.matchAll(/<li class="b_algo"[\s\S]*?<\/li>/gi)) {
    if (results.length >= maxResults) break;
    const markup = block[0];
    const titleMatch = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(markup);
    if (!titleMatch) continue;
    const title = stripHtml(titleMatch[2] ?? '');
    const href = titleMatch[1] ?? '';
    if (!title || !href) continue;
    const snippetMatch = /<p[^>]*>([\s\S]*?)<\/p>/.exec(markup);
    results.push({
      title,
      url: decodeBingRedirect(href),
      snippet: snippetMatch ? stripHtml(snippetMatch[1] ?? '') : '',
    });
  }
  return results;
}

// Baidu renders page chrome with the same result-card markup as organic
// hits: related-search cards linking back to Baidu, a satisfaction survey on
// nourl.ubs.baidu.com and a "生活服务" weather widget whose snippet is a jumble
// of UI labels. Content hosts (baike, baijiahao) are kept.
const isBaiduChrome = (url: string): boolean =>
  /^https?:\/\/www\.baidu\.com\/(s|link)\b/.test(url) ||
  /^https?:\/\/(nourl\.ubs|weathernew\.pae)\.baidu\.com\b/.test(url);

// Baidu results are `<div class="result c-container ...">` cards whose opening
// tag carries the real destination in `mu`, so no redirect hop is needed. The
// card markup itself is obfuscated (hashed class names, huge inline JSON
// comments), so only the block boundary, the `mu` attribute and the `<h3>`
// title are relied upon.
const BAIDU_BLOCK = /<div[^>]+class="[^"]*\bresult\b[^"]*c-container[^"]*"[^>]*>/g;

export function parseBaiduHtml(html: string, maxResults = DEFAULT_WEB_RESULTS): WebSearchResult[] {
  if (/wappass\.baidu\.com|安全验证/.test(html)) return [];
  const starts = [...html.matchAll(BAIDU_BLOCK)];
  const results: WebSearchResult[] = [];
  for (let i = 0; i < starts.length && results.length < maxResults; i++) {
    const tag = starts[i]?.[0] ?? '';
    const from = starts[i]?.index ?? 0;
    const to = i + 1 < starts.length ? (starts[i + 1]?.index ?? from + 8000) : from + 8000;
    const body = html.slice(from + tag.length, Math.min(to, html.length));
    const titleMatch = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(body);
    if (!titleMatch) continue;
    const title = stripHtml(titleMatch[1] ?? '');
    const url = stripHtml(/\smu="([^"]+)"/.exec(tag)?.[1] ?? '');
    if (!title || !/^https?:\/\//.test(url)) continue;
    if (isBaiduChrome(url)) continue;
    const rest = body
      .slice((titleMatch.index ?? 0) + titleMatch[0].length)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ');
    results.push({ title, url, snippet: stripHtml(rest).slice(0, 300) });
  }
  return results;
}

// Sogou result cards are `<div class="vrwrap">` blocks; the real destination
// is duplicated in the block's `data-url` attribute, so no redirect hop and no
// dependence on the hashed template classes.
const SOGOU_BLOCK = /<div class="vrwrap"[^>]*>/g;

export function parseSogouHtml(html: string, maxResults = DEFAULT_WEB_RESULTS): WebSearchResult[] {
  if (/安全验证|antispider/.test(html)) return [];
  const starts = [...html.matchAll(SOGOU_BLOCK)];
  const results: WebSearchResult[] = [];
  for (let i = 0; i < starts.length && results.length < maxResults; i++) {
    const tag = starts[i]?.[0] ?? '';
    const from = starts[i]?.index ?? 0;
    const to = i + 1 < starts.length ? (starts[i + 1]?.index ?? from + 8000) : from + 8000;
    const body = html.slice(from + tag.length, Math.min(to, html.length));
    const titleMatch =
      /<h3[^>]*class="vr-title[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(body);
    if (!titleMatch) continue;
    const title = stripHtml(titleMatch[2] ?? '');
    const dataUrl = stripHtml(/data-url="([^"]+)"/.exec(body)?.[1] ?? '');
    const href = stripHtml(titleMatch[1] ?? '');
    const url = /^https?:\/\//.test(dataUrl) ? dataUrl : href;
    if (!title || !/^https?:\/\//.test(url)) continue;
    if (/^https?:\/\/(www\.)?sogou\.com\b/.test(url)) continue;
    const rest = body
      .slice((titleMatch.index ?? 0) + titleMatch[0].length)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ');
    results.push({ title, url, snippet: stripHtml(rest).slice(0, 300) });
  }
  return results;
}

// Conversational wrappers ("查一下…如何", "帮我搜…吗") push the engines toward
// forum and weibo chatter instead of authoritative pages; strip them before
// hitting the SERPs.
const LEADING_FILLER =
  /^(?:请|帮我|麻烦)*(?:查一下|查一查|查查|搜一下|搜搜|搜索一下|查询一下|搜一搜)/;
const TRAILING_FILLER = /(?:如何|怎么样|么|吗|呢|[?？!！\s])+$/;

export function normalizeSearchQuery(query: string): string {
  const stripped = query.trim().replace(LEADING_FILLER, '').replace(TRAILING_FILLER, '').trim();
  return stripped.length >= 2 ? stripped : query.trim();
}

// Engines on this network occasionally answer with the results of an unrelated
// query (Bing returning Windows-troubleshooting pages for a weather question).
// Keeping only results that share a token with the query stops that pollution
// from reaching the model as if it were evidence.
export function queryTokens(query: string): string[] {
  const latin = query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  const bigrams: string[] = [];
  for (const run of query.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let i = 0; i + 2 <= run.length; i++) bigrams.push(run.slice(i, i + 2));
  }
  return [...latin, ...bigrams];
}

export function filterRelevant(query: string, results: WebSearchResult[]): WebSearchResult[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return results;
  return results.filter((result) => {
    const haystack = `${result.title} ${result.snippet}`.toLowerCase();
    return tokens.some((token) => haystack.includes(token.toLowerCase()));
  });
}

interface SearchProvider {
  name: string;
  url: (query: string) => string;
  headers?: Record<string, string>;
  parse: (html: string, maxResults: number) => WebSearchResult[];
}

const BAIDU: SearchProvider = {
  name: 'baidu',
  url: (query) => `${BAIDU_ENDPOINT}?wd=${encodeURIComponent(query)}&rn=10&ie=utf-8`,
  headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
  parse: parseBaiduHtml,
};

const bing = (chinese: boolean): SearchProvider => ({
  name: 'bing',
  url: (query) => {
    const market = chinese ? 'zh-CN' : 'en-US';
    const setlang = chinese ? 'zh-CN' : 'en';
    return `${BING_ENDPOINT}?q=${encodeURIComponent(query)}&mkt=${market}&setlang=${setlang}&count=10`;
  },
  headers: { 'Accept-Language': chinese ? 'zh-CN,zh;q=0.9' : 'en-US,en;q=0.9' },
  parse: parseBingHtml,
});

const SOGOU: SearchProvider = {
  name: 'sogou',
  url: (query) => `${SOGOU_ENDPOINT}?query=${encodeURIComponent(query)}`,
  headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
  parse: parseSogouHtml,
};

const DDG: SearchProvider = {
  name: 'ddg',
  url: (query) => `${DDG_ENDPOINT}?q=${encodeURIComponent(query)}`,
  parse: parseDdgHtml,
};

export function providersFor(query: string): SearchProvider[] {
  return [BAIDU, SOGOU, bing(CJK_PATTERN.test(query)), DDG];
}

export async function searchWebWith(
  fetchImpl: typeof fetch,
  query: string,
  maxResults = DEFAULT_WEB_RESULTS,
): Promise<WebSearchResult[]> {
  const raw = query.trim();
  if (!raw) return [];
  const q = normalizeSearchQuery(raw);
  if (q !== raw) aiFileLog(`websearch query normalized: "${raw}" -> "${q}"`);
  let lastError: unknown = null;
  for (const provider of providersFor(q)) {
    try {
      const response = await fetchImpl(provider.url(q), {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', ...provider.headers },
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`${provider.name} search failed: ${response.status}`);
      const parsed = provider.parse(await response.text(), maxResults);
      const results = filterRelevant(q, parsed);
      aiFileLog(
        `websearch ${provider.name}: ${results.length} relevant of ${parsed.length} parsed`,
      );
      if (results.length > 0) return results;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      aiFileLog(`websearch ${provider.name} failed: ${message}`);
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

/**
 * Free web search for the AI chat. On Tauri the request leaves from the Rust
 * HTTP transport (no CORS, no cleartext block); on web builds it goes through
 * the app's own /api/web/search route because search engines send no CORS
 * headers. Providers are tried in order until one returns results: Baidu
 * first, then Bing (whose market matches the query language), then DuckDuckGo.
 */
export async function searchWeb(
  query: string,
  maxResults = DEFAULT_WEB_RESULTS,
): Promise<WebSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  if (!isTauriAppPlatform()) {
    const response = await fetch('/api/web/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, maxResults }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Web search failed' }));
      throw new Error(error.error || `Web search failed: ${response.status}`);
    }
    const data = (await response.json()) as { results: WebSearchResult[] };
    return data.results;
  }

  return searchWebWith(getAIFetch(), q, maxResults);
}
