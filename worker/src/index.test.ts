import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index';

const store = new Map<string, Response>();
const ctx = { waitUntil: (p: Promise<unknown>) => void p } as unknown as ExecutionContext;

vi.stubGlobal('caches', {
  default: {
    match: async (req: Request) => store.get(req.url)?.clone(),
    put: async (req: Request, res: Response) => void store.set(req.url, res),
  },
});

const call = (path: string, method = 'GET') =>
  worker.fetch(new Request(`https://api.example/${path}`, { method }), {}, ctx);

afterEach(() => {
  store.clear();
  vi.unstubAllGlobals();
  vi.stubGlobal('caches', {
    default: {
      match: async (req: Request) => store.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => void store.set(req.url, res),
    },
  });
});

describe('worker', () => {
  it('proxies allowed USGS feeds and caches them', async () => {
    const upstream = vi.fn(async () => new Response('{"features":[]}', { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const res = await call('api/usgs/all_hour');
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toBe('public, max-age=55');
    expect(await res.text()).toBe('{"features":[]}');
    await call('api/usgs/all_hour');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('refuses other feeds and paths', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect((await call('api/usgs/significant_month')).status).toBe(404);
    expect((await call('api/other')).status).toBe(404);
    expect((await call('api/usgs/all_hour', 'POST')).status).toBe(405);
  });

  it('reports upstream failures as 502', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    expect((await call('api/usgs/all_day')).status).toBe(502);
  });
});

describe('entry module', () => {
  it('exports only the handler (workerd rejects other named exports)', async () => {
    const mod = await import('./index');
    expect(Object.keys(mod)).toEqual(['default']);
  });

  it('cron constants match wrangler.jsonc', async () => {
    const { readFileSync } = await import('node:fs');
    const { CRON_KEV, CRON_NVD } = await import('./crons');
    const cfg = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
    expect(cfg).toContain(`"${CRON_NVD}"`);
    expect(cfg).toContain(`"${CRON_KEV}"`);
  });
});
