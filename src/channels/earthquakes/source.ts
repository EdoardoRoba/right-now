/**
 * USGS earthquake feeds → LiveEvent.
 * Feed docs: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
 */
import { palette } from '../../core/palette';
import { createPoller } from '../../core/poller';
import type { ChannelContext, LiveEvent } from '../../core/types';

export const FEED_BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/';
export type FeedName = 'all_hour' | 'all_day';

/** Same threshold as USGS's own "M2.5+" feeds. */
export const IMPORTANT_MAG = 2.5;
export const MAX_DEPTH_KM = 700;
export const POLL_MS = 60_000;
export const MAX_BACKOFF_MS = 10 * 60_000;
/** After a gap this long (e.g. a hidden tab), refill from the past-day feed. */
export const REFILL_AFTER_MS = 50 * 60_000;

// ---------------------------------------------------------------------------
// Mapping (mockup D)
// ---------------------------------------------------------------------------

/** Magnitudes are compared and shown at one decimal, like USGS shows them. */
export const roundMag = (mag: number) => Math.round(mag * 10) / 10;

export function magColor(mag: number): string {
  if (mag >= 5) return palette.strong;
  if (mag >= 3) return palette.mid;
  return palette.small;
}

/** Dot diameter in px: 6 + mag² × 1.5, clamped (negative magnitudes exist). */
export function magSize(mag: number): number {
  const m = Math.max(0, mag);
  return Math.min(80, Math.max(6, 6 + m * m * 1.5));
}

/** 0 = surface (top), 1 = 700 km (bottom). sqrt so 0–70 km isn't squashed. */
export function depthToY(depthKm: number): number {
  const d = Math.min(MAX_DEPTH_KM, Math.max(0, depthKm));
  return Math.sqrt(d / MAX_DEPTH_KM);
}

export const isImportant = (mag: number) => roundMag(mag) >= IMPORTANT_MAG;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface UsgsFeature {
  id?: unknown;
  properties?: {
    mag?: number | null;
    place?: string | null;
    title?: string | null;
    time?: number | null;
    updated?: number | null;
    url?: string | null;
    tsunami?: number | null;
    type?: string | null;
    status?: string | null;
    magType?: string | null;
  } | null;
  geometry?: { coordinates?: (number | null)[] } | null;
}

/** Turns one GeoJSON feature into a LiveEvent, or null if we don't show it. */
export function featureToEvent(f: UsgsFeature, receivedAt: number): LiveEvent | null {
  const p = f.properties;
  if (!p || typeof f.id !== 'string') return null;
  // Only earthquakes: quarry blasts, explosions, ice quakes etc. are skipped (see DECISIONS.md).
  if (p.type !== 'earthquake') return null;
  if (typeof p.mag !== 'number' || !Number.isFinite(p.mag)) return null;
  if (typeof p.time !== 'number' || !Number.isFinite(p.time)) return null;

  const mag = roundMag(p.mag);
  const rawDepth = f.geometry?.coordinates?.[2];
  const depthKnown = typeof rawDepth === 'number' && Number.isFinite(rawDepth);
  const depthKm = depthKnown ? rawDepth : 0;
  const place = cleanPlace(p.place, p.title);
  const important = isImportant(mag);
  const lon = f.geometry?.coordinates?.[0];
  const lat = f.geometry?.coordinates?.[1];

  return {
    id: f.id,
    channel: 'earthquakes',
    time: p.time,
    receivedAt,
    title: place,
    value: mag,
    y: depthToY(depthKm),
    size: magSize(mag),
    color: magColor(mag),
    important,
    label: place,
    labelValue: `M${mag.toFixed(1)}`,
    url: safeUsgsUrl(p.url),
    meta: {
      depthKm: Math.round(depthKm * 10) / 10,
      depthKnown,
      tsunami: p.tsunami === 1,
      status: p.status ?? 'unknown',
      magType: p.magType ?? '',
      updated: p.updated ?? p.time,
      ...(typeof lat === 'number' && typeof lon === 'number' ? { lat, lon } : {}),
    },
  };
}

export function parseFeed(json: unknown, receivedAt: number): LiveEvent[] {
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) throw new Error('USGS feed: missing "features" array');
  const out: LiveEvent[] = [];
  for (const f of features) {
    const ev = featureToEvent(f as UsgsFeature, receivedAt);
    if (ev) out.push(ev);
  }
  return out;
}

function cleanPlace(place?: string | null, title?: string | null): string {
  const p = place?.trim();
  if (p) return p;
  const fromTitle = title?.replace(/^M\s*-?[\d.]+\s*-\s*/, '').trim();
  return fromTitle || 'Location not yet named';
}

/** Event links must point at USGS; anything else is dropped. */
function safeUsgsUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith('usgs.gov') ? u.href : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export async function fetchFeed(
  feed: FeedName,
  receivedAt: number,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveEvent[]> {
  // `cache: 'no-cache'` makes the browser revalidate with ETag / If-Modified-Since
  // for us (a hand-set If-Modified-Since header would force a CORS preflight).
  const res = await fetchImpl(`${FEED_BASE}${feed}.geojson`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`USGS ${feed}: HTTP ${res.status}`);
  return parseFeed(await res.json(), receivedAt);
}

/** Initial fill from the past-day feed, then the past-hour feed every minute. */
export function startUsgs(
  { store, freshness }: ChannelContext,
  opts: { fetchImpl?: typeof fetch; now?: () => number } = {},
): () => void {
  const now = opts.now ?? Date.now;
  const poller = createPoller({
    intervalMs: POLL_MS,
    maxBackoffMs: MAX_BACKOFF_MS,
    now,
    run: async () => {
      const t = now();
      const needsFill =
        freshness.lastSuccess === null || t - freshness.lastSuccess > REFILL_AFTER_MS;
      const events = await fetchFeed(needsFill ? 'all_day' : 'all_hour', t, opts.fetchImpl);
      store.upsert(events, now());
      freshness.markSuccess(now());
    },
    onError: (err) => {
      freshness.markError(now());
      console.warn('[earthquakes]', err);
    },
  });
  poller.start();
  return () => poller.stop();
}
