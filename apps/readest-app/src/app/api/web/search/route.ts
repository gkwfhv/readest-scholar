import { DEFAULT_WEB_RESULTS, searchWebWith } from '@/services/ai/webSearch';

// Web-build fallback for searchWeb(): the browser can't reach the search
// engines directly (no CORS headers), so the request leaves from the server.
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

    const results = await searchWebWith(
      (url, init) => fetch(url, { ...init, cache: 'no-store' }),
      body.query.trim(),
      maxResults,
    );
    return Response.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: `Web search failed: ${message}` }, { status: 502 });
  }
}
