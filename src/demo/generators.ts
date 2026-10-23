/**
 * DEV-ONLY fake data, ported from the mockups' generators. Enabled by ?demo=1,
 * which also shows a "DEMO DATA" badge. Never used in production mode.
 *
 * Unlike the mockups this runs in real time (no time-lapse), but a bit busier
 * than the real world so the layout can be judged.
 */
import type { ChannelContext } from '../core/types';
import { payloadToEvents } from '../channels/exploited/source';
import type { CompactCve, ExploitedPayload, KevItem, KevScore } from '../../worker/src/types';
import { featureToEvent } from '../channels/earthquakes/source';
import {
  parseChange,
  setCurrent,
  WikipediaRuntime,
  type RawChange,
} from '../channels/wikipedia/source';

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

// ---------------------------------------------------------------------------
// Wikipedia (mockup F): background edits at real speed, plus a burst of edits
// to one article every 10–15 s that goes through the real surge detector.
// ---------------------------------------------------------------------------

const WP_TITLES = [
  'Atlantic hurricane season',
  'Solar eclipse',
  'Mount Etna',
  'Nobel Prize in Physics',
  'Formula One',
  'James Webb Space Telescope',
  'Rome',
  'Champions League',
  'Bitcoin',
  'Aurora',
  'Volcano',
  'Climate of Italy',
  'Mars',
  'Olympic Games',
  'Large language model',
  'Tsunami',
  'Euro',
  'Comet',
  'Supernova',
  'Venice',
];
const WP_SURGE = [
  'Mount Etna',
  'Solar eclipse',
  'Nobel Prize in Physics',
  'Comet',
  'Aurora',
  'Tsunami',
];
const WP_SERVERS = ['en', 'it', 'de', 'es', 'fr', 'ja'].map((l) => `${l}.wikipedia.org`);

function fakeBytes(): number {
  const sign = Math.random() < 0.68 ? 1 : -1;
  return Math.round(sign * Math.pow(10, Math.random() * Math.random() * 4.2));
}

function fakeChange(
  title: string,
  server: string,
  editor: string,
  bot: boolean,
  bytes = fakeBytes(),
): RawChange {
  seq += 1;
  return {
    meta: { id: `DEMO-2026-${10000 + seq}`, dt: new Date().toISOString() },
    type: 'edit',
    namespace: 0,
    title,
    server_name: server,
    bot,
    editor,
    length: { old: 5000, new: 5000 + bytes },
  };
}

export function startWikipediaDemo({ store, freshness }: ChannelContext): () => void {
  const rt = new WikipediaRuntime();
  setCurrent(rt);
  const push = (raw: RawChange) => {
    const edit = parseChange(raw);
    if (edit) store.upsert(rt.ingest(edit, Date.now()), Date.now());
    freshness.markSuccess(Date.now());
  };
  const background = setInterval(() => {
    const n = Math.random() < 0.55 ? 1 : 0;
    for (let i = 0; i < n + (Math.random() < 0.15 ? 1 : 0); i++) {
      push(
        fakeChange(pick(WP_TITLES), pick(WP_SERVERS), `demo-${Math.random()}`, Math.random() < 0.2),
      );
    }
  }, 200);
  let burst: ReturnType<typeof setTimeout>;
  const surge = () => {
    const title = pick(WP_SURGE);
    const server = pick(WP_SERVERS);
    let i = 0;
    const tick = setInterval(() => {
      push(
        fakeChange(
          title,
          server,
          `demo-editor-${i % 7}`,
          false,
          i === 0 ? Math.round(2000 + Math.random() * 6000) : undefined,
        ),
      );
      if (++i >= 18) clearInterval(tick);
    }, 90);
    burst = setTimeout(surge, 10_000 + Math.random() * 5_000);
  };
  burst = setTimeout(surge, 1_500);
  const prune = setInterval(() => rt.prune(Date.now(), 6 * 3_600_000), 5_000);
  return () => {
    clearInterval(background);
    clearInterval(prune);
    clearTimeout(burst);
    setCurrent(null);
  };
}

// ---------------------------------------------------------------------------
// Exploited vulnerabilities (mockup E): generic product names and DEMO ids only.
// ---------------------------------------------------------------------------

const EX_PRODUCTS = [
  ['Example', 'VPN Gateway'],
  ['Sample Corp', 'Mail Server'],
  ['Acme', 'File Transfer Appliance'],
  ['Demo Systems', 'Web Framework'],
  ['Placeholder', 'Firewall OS'],
  ['Testware', 'Remote Desktop'],
];
const EX_KINDS = [
  'Authentication bypass',
  'Remote code execution',
  'Path traversal',
  'Command injection',
  'Deserialization of untrusted data',
];

function demoCve(published: number): CompactCve {
  seq += 1;
  const score =
    Math.random() < 0.08 ? null : Math.round((1 + 9 * Math.pow(Math.random(), 0.7)) * 10) / 10;
  return {
    id: `DEMO-2026-${10000 + seq}`,
    published,
    score,
    version: score === null ? null : '3.1',
    severity: null,
    excerpt: `${pick(EX_KINDS)} in a demo product.`,
  };
}

function demoKev(daysAgo: number): KevItem & KevScore {
  seq += 1;
  const [vendor, product] = pick(EX_PRODUCTS) as [string, string];
  const added = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const due = new Date(Date.now() + (21 - daysAgo) * 86_400_000).toISOString().slice(0, 10);
  const score = Math.round((7 + 3 * Math.random()) * 10) / 10;
  return {
    cve: `DEMO-2026-${10000 + seq}`,
    vendor,
    product,
    name: `${vendor} ${product} ${pick(EX_KINDS)} Vulnerability`,
    dateAdded: added,
    dueDate: due,
    ransomware: Math.random() < 0.3,
    score,
    version: '3.1',
    severity: score >= 9 ? 'CRITICAL' : 'HIGH',
  };
}

export function startExploitedDemo({ store, freshness }: ChannelContext): () => void {
  const now = Date.now();
  const cves = Array.from({ length: 160 }, () => demoCve(now - Math.random() * 24 * 3_600_000));
  const kev = [0, 0.4, 1, 3, 6, 9].map(demoKev);
  const payload: ExploitedPayload = {
    generatedAt: now,
    nvd: { fetchedAt: now, ok: true, cves },
    kev: {
      fetchedAt: now,
      ok: true,
      catalogVersion: 'demo',
      dateReleased: new Date(now - 3_600_000).toISOString(),
      items: kev,
    },
  };
  store.upsert(payloadToEvents(payload, now), now);
  freshness.markSuccess(now);
  const timer = setInterval(() => {
    const t = Date.now();
    store.upsert(
      payloadToEvents(
        {
          ...payload,
          nvd: { ...payload.nvd, cves: [demoCve(t)] },
          kev: { ...payload.kev, items: [] },
        },
        t,
      ),
      t,
    );
    freshness.markSuccess(t);
  }, 4_000);
  return () => clearInterval(timer);
}
