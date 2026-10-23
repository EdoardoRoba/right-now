/**
 * Right Now Worker: serves the static site (Workers static assets) and the
 * small API under /api/*. Only /api/* runs this code (`run_worker_first`);
 * every other request is a free static-asset hit.
 *
 * - GET /api/exploited — compact KEV + NVD JSON built by the cron jobs below
 * - GET /api/usgs/:feed — cached USGS pass-through (CORS fallback, unused today)
 * - GET /api/health
 * - cron "*\/20 * * * *" — NVD new CVEs (+ CVSS lookups for KEV entries)
 * - cron "17 *\/2 * * *" — CISA KEV head
 */
import { CRON_KEV } from './crons';
import { buildPayload, runKev, runNvd, type Env as JobEnv } from './exploited';

const USGS_BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/';
const USGS_FEEDS = new Set(['all_hour', 'all_day']);
const USGS_TTL_S = 55;
/** The data changes every 20 min; browsers poll every 5 min. */
const EXPLOITED_TTL_S = 120;
const USER_AGENT = 'right-now (+https://github.com/EdoardoRoba/right-now)';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
};

export interface Env extends Partial<JobEnv> {
  ASSETS?: Fetcher;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(req) : json({ error: 'not found' }, 404);
    }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return json({ error: 'method not allowed' }, 405);

    if (url.pathname === '/api/health') return json({ ok: true });
    if (url.pathname === '/api/exploited') return exploited(env, ctx);

    const usgs = url.pathname.match(/^\/api\/usgs\/([a-z0-9_]+)$/);
    if (usgs) return usgsFeed(usgs[1]!, ctx);

    return json({ error: 'not found' }, 404);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.DATA) return;
    const jobEnv = env as JobEnv;
    const now = Date.now();
    if (event.cron === CRON_KEV) ctx.waitUntil(runKev(jobEnv, now));
    else ctx.waitUntil(runNvd(jobEnv, now));
  },
} satisfies ExportedHandler<Env>;

async function exploited(env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.DATA) return json({ error: 'storage not configured' }, 503);
  const cache = caches.default;
  const key = new Request('https://right-now.cache/api/exploited');
  const hit = await cache.match(key);
  if (hit) return hit;

  const jobEnv = env as JobEnv;
  const payload = await buildPayload(jobEnv, Date.now());
  // First visit after a fresh deploy: start filling instead of waiting for the crons.
  if (payload.kev.fetchedAt === null || payload.nvd.fetchedAt === null) {
    const warming = await env.DATA.get('warming');
    if (!warming) {
      await env.DATA.put('warming', '1', { expirationTtl: 300 });
      const now = Date.now();
      ctx.waitUntil(runKev(jobEnv, now).then(() => runNvd(jobEnv, now)));
    }
  }
  const res = new Response(JSON.stringify(payload), {
    headers: {
      ...CORS,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${EXPLOITED_TTL_S}`,
    },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

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
