/**
 * Right Now API Worker.
 *
 * v1: `/api/usgs/:feed` — a cached pass-through of the USGS summary feeds, kept
 * as a fallback in case browsers ever can't fetch USGS directly (CORS). The
 * frontend calls USGS directly by default, so this costs nothing per visitor.
 * v1.2 will add `/api/exploited` and the KEV/NVD cron jobs here.
 */

const USGS_BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/';
const USGS_FEEDS = new Set(['all_hour', 'all_day']);
const USGS_TTL_S = 55;
const USER_AGENT = 'right-now (+https://github.com/EdoardoRoba/right-now)';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
};

export type Env = Record<string, never>;

export default {
  async fetch(req: Request, _env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return json({ error: 'method not allowed' }, 405);

    if (url.pathname === '/api/health') return json({ ok: true });

    const usgs = url.pathname.match(/^\/api\/usgs\/([a-z0-9_]+)$/);
    if (usgs) return usgsFeed(usgs[1]!, ctx);

    return json({ error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;

async function usgsFeed(feed: string, ctx: ExecutionContext): Promise<Response> {
  if (!USGS_FEEDS.has(feed)) return json({ error: 'unknown feed' }, 404);

  const cache = caches.default;
  const key = new Request(`https://right-now.cache/usgs/${feed}`);
  const hit = await cache.match(key);
  if (hit) return hit;

  const upstream = await fetch(`${USGS_BASE}${feed}.geojson`, {
    headers: { 'user-agent': USER_AGENT },
  });
  if (!upstream.ok) return json({ error: `upstream ${upstream.status}` }, 502);

  const res = new Response(upstream.body, {
    headers: {
      ...CORS,
      'content-type': 'application/geo+json; charset=utf-8',
      'cache-control': `public, max-age=${USGS_TTL_S}`,
    },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  });
}
