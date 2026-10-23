/**
 * DEV-ONLY fake data, ported from the mockups' generators. Enabled by ?demo=1,
 * which also shows a "DEMO DATA" badge. Never used in production mode.
 *
 * Unlike the mockups this runs in real time (no time-lapse), but a bit busier
 * than the real world so the layout can be judged.
 */
import type { ChannelContext } from '../core/types';
import { featureToEvent } from '../channels/earthquakes/source';

const PLACES = [
  'Off the east coast of Honshu, Japan',
  'Central Chile',
  'Southern Alaska',
  'Campi Flegrei, Italy',
  'Tonga Islands',
  'Northern California',
  'Crete, Greece',
  'Southern Sumatra, Indonesia',
  'Reykjanes Peninsula, Iceland',
  'Oaxaca, Mexico',
  'Hawaii, Big Island',
  'Kermadec Islands',
  'Central Peru',
  'Eastern Türkiye',
  'Mindanao, Philippines',
];

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)] as T;
let seq = 0;

function fakeQuake(time: number, notable: boolean) {
  const mag = notable ? 2.5 + 4.5 * Math.pow(Math.random(), 2.2) : -0.5 + Math.random() * 2.9;
  const depth = notable && Math.random() < 0.15 ? 70 + Math.random() * 550 : 2 + Math.random() * 90;
  seq += 1;
  return {
    id: `DEMO-2026-${String(10000 + seq)}`,
    properties: {
      mag,
      place: pick(PLACES),
      time,
      type: 'earthquake',
      tsunami: notable && mag > 6.5 ? 1 : 0,
      url: 'https://earthquake.usgs.gov/earthquakes/map/',
    },
    geometry: { coordinates: [0, 0, depth] },
  };
}

export function startEarthquakeDemo({ store, freshness }: ChannelContext): () => void {
  const now = Date.now();
  const window = store.windowMs;
  const initial = [];
  // ?dots=N overrides the starting count (used for performance measurements).
  const dots = Number(new URLSearchParams(location.search).get('dots')) || 140;
  for (let i = 0; i < dots; i++) initial.push(fakeQuake(now - Math.random() * window, false));
  for (let i = 0; i < 8; i++) initial.push(fakeQuake(now - Math.random() * window, true));
  store.upsert(
    initial.map((f) => featureToEvent(f, now)).filter((e) => e !== null),
    now,
  );
  freshness.markSuccess(now);

  const timers: ReturnType<typeof setTimeout>[] = [];
  const loop = (minMs: number, maxMs: number, notable: boolean) => {
    const t = setTimeout(
      () => {
        const at = Date.now();
        const ev = featureToEvent(fakeQuake(at - Math.random() * 1500, notable), at);
        if (ev) store.upsert([ev], at);
        freshness.markSuccess(at);
        loop(minMs, maxMs, notable);
      },
      minMs + Math.random() * (maxMs - minMs),
    );
    timers[notable ? 1 : 0] = t;
  };
  loop(800, 3000, false);
  loop(12_000, 30_000, true);
  return () => timers.forEach(clearTimeout);
}
