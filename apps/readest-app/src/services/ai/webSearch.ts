import { isTauriAppPlatform } from '@/services/environment';
import { getAIFetch } from './utils/httpFetch';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

// DuckDuckGo's no-JS HTML endpoint: stable markup, no API key, no rate-limit
// contract. Scraping it is the classic free search fallback.
export const DDG_ENDPOINT = 'https://html.duckduckgo.com/html/';
export const DEFAULT_WEB_RESULTS = 6;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SEARCH_TIMEOUT_MS = 12_000;

const stripHtml = (raw: string): string =>
  raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
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

/**
 * Free web search for the AI chat. On Tauri the request leaves from the Rust
 * HTTP transport (no CORS, no cleartext block); on web builds it goes through
 * the app's own /api/web/search route because DDG sends no CORS headers.
 */
export async function searchWeb(
  query: string,
  maxResults = DEFAULT_WEB_RESULTS,
): Promise<WebSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  if (isTauriAppPlatform()) {
    const response = await getAIFetch()(`${DDG_ENDPOINT}?q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Web search failed: ${response.status}`);
    return parseDdgHtml(await response.text(), maxResults);
  }

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
