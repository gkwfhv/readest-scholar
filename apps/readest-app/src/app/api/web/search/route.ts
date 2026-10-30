import { DDG_ENDPOINT, DEFAULT_WEB_RESULTS, parseDdgHtml } from '@/services/ai/webSearch';

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Web-build fallback for searchWeb(): the browser can't reach DuckDuckGo
// directly (no CORS headers), so the request leaves from the server instead.
export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => null)) as {
      query?: unknown;
      maxResults?: unknown;
    } | null;
    if (!body?.query || typeof body.query !== 'string' || !body.query.trim()) {
      return Response.json({ error: 'Query required' }, { status: 400 });
    }
    const maxResults =
      typeof body.maxResults === 'number' && body.maxResults > 0
        ? Math.min(body.maxResults, DEFAULT_WEB_RESULTS)
        : DEFAULT_WEB_RESULTS;

    const upstream = await fetch(`${DDG_ENDPOINT}?q=${encodeURIComponent(body.query.trim())}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!upstream.ok) {
      return Response.json(
        { error: `Upstream search failed: ${upstream.status}` },
        { status: 502 },
      );
    }
    return Response.json({ results: parseDdgHtml(await upstream.text(), maxResults) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: `Web search failed: ${message}` }, { status: 502 });
  }
}
