/** Earthquakes channel (v1) — USGS real-time feeds, mockup D. */
import { palette } from '../../core/palette';
import type { Channel, LiveEvent } from '../../core/types';
import { IMPORTANT_MAG, POLL_MS, magColor, startUsgs } from './source';

const MIN = 60_000;
const magPct = (mag: number) => Math.min(100, Math.max(0, ((mag - 1) / 7) * 100));
const depthText = (ev: LiveEvent) =>
  ev.meta.depthKnown ? `${Math.round(Number(ev.meta.depthKm))} km deep` : 'depth not yet known';

const earthquakes: Channel = {
  id: 'earthquakes',
  name: 'Earthquakes',
  tagline: [
    'EVERY QUAKE ON EARTH',
    'AS SOON AS USGS PUBLISHES IT',
    'REAL TIME, NO TIME-LAPSE',
    'LIVE SOURCE: USGS, PUBLIC DOMAIN',
  ],
  attribution: 'Data: U.S. Geological Survey',
  sources: [
    {
      name: 'USGS real-time earthquake feeds (GeoJSON)',
      url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php',
      terms:
        'U.S. public domain. Updated every minute; automatic locations usually appear within minutes and are revised as seismologists review them. Smaller quakes are mostly recorded where station networks are dense (e.g. the US).',
    },
  ],
  windowMs: 60 * MIN,
  retainImportantMs: 24 * 60 * MIN,
  pollMs: POLL_MS,
  axis: {
    top: 'SHALLOW',
    bottom: 'DEEP',
    ticks: ['−60 min', '−45', '−30', '−15', 'now'],
    mobileTicks: ['−60 min', 'now'],
  },
  sideTitle: 'BEFORE THAT',
  sideItem: (ev) => ({ value: ev.value.toFixed(1), title: ev.title }),

  pulse: {
    kicker: `LATEST M${IMPORTANT_MAG}+`,
    emptyText: `Waiting for the first M${IMPORTANT_MAG}+ quake…`,
    value: (ev) => ev.value.toFixed(1),
    subtitle: depthText,
    bar: {
      pct: (ev) => magPct(ev.value),
      labels: [
        { text: 'M1', at: 0 },
        { text: 'M5 strong', at: magPct(5) },
        { text: 'M8 great', at: 100 },
      ],
    },
    tags: (ev) =>
      ev.meta.tsunami
        ? [{ text: 'Tsunami information issued — check official sources', href: ev.url }]
        : [],
    linkText: 'View on USGS',
    announce: (ev) =>
      `New earthquake: magnitude ${ev.value.toFixed(1)}, ${ev.title}, ${
        ev.meta.depthKnown
          ? `${Math.round(Number(ev.meta.depthKm))} kilometers deep`
          : 'depth unknown'
      }.`,
  },

  stats(store, now) {
    const live = store.inWindow(now);
    const strongest = live.reduce<LiveEvent | undefined>(
      (best, e) => (!best || e.value > best.value ? e : best),
      undefined,
    );
    return [
      { label: 'In the river', value: String(live.length) },
      {
        label: 'Strongest',
        value: strongest ? `M${strongest.value.toFixed(1)}` : '—',
        color: strongest ? magColor(strongest.value) : palette.faint,
      },
    ];
  },

  summary(store, now) {
    const live = store.inWindow(now);
    if (!live.length) return 'No earthquakes recorded in the last 60 minutes yet.';
    const max = Math.max(...live.map((e) => e.value));
    return `${live.length} earthquakes in the last 60 minutes. Strongest: magnitude ${max.toFixed(1)}.`;
  },

  start: (ctx) => startUsgs(ctx),
  // Demo code is lazy-loaded so it never ships in the production path.
  startDemo(ctx) {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import('../../demo/generators').then((m) => {
      if (!cancelled) stop = m.startEarthquakeDemo(ctx);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  },
};

export default earthquakes;
