/** Wikipedia pulse channel (v1.1) — Wikimedia EventStreams, mockup F. */
import { palette } from '../../core/palette';
import type { Channel, LiveEvent } from '../../core/types';
import { current, startWikipedia } from './source';
import { SURGE_MIN_EDITORS, SURGE_MIN_EDITS, SURGE_WINDOW_MS } from './surge';

const RETAIN_SURGES_MS = 6 * 60 * 60_000;
/** A surge stays the hero this long before the busiest article may replace it. */
const SURGE_HERO_MS = 60 * 60_000;
const isSurge = (ev: LiveEvent) => ev.meta.kind === 'surge';
const editors = (ev: LiveEvent) => Number(ev.meta.editors);

const wikipedia: Channel = {
  id: 'wikipedia',
  name: 'Wikipedia pulse',
  tagline: [
    'EVERY EDIT TO WIKIPEDIA',
    'REAL SPEED, NO TIME-LAPSE',
    'SOURCE: WIKIMEDIA EVENTSTREAMS',
    'ARTICLE TEXT CC BY-SA',
  ],
  attribution: 'Live edits: Wikimedia EventStreams · Wikipedia content CC BY-SA',
  sources: [
    {
      name: 'Wikimedia EventStreams (recentchange)',
      url: 'https://stream.wikimedia.org/?doc',
      terms:
        'Public stream of changes to all Wikimedia wikis, under the Wikimedia Terms of Use. We keep only edits to Wikipedia articles and show titles and sizes. Usernames and IP addresses are never shown or stored. Your browser connects to Wikimedia directly (about 3 MB per minute) and disconnects while the tab is hidden.',
    },
    {
      name: 'Wikipedia (article links)',
      url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      terms: 'Wikipedia text is available under CC BY-SA. Every title links to its article.',
    },
  ],
  windowMs: 60_000,
  retainImportantMs: RETAIN_SURGES_MS,
  pollMs: 5_000,
  axis: {
    top: 'TEXT ADDED ↑',
    bottom: 'TEXT REMOVED ↓',
    topColor: palette.small,
    bottomColor: palette.strong,
    centerLine: true,
    ticks: ['−60 s', '−45', '−30', '−15', 'now'],
    mobileTicks: ['−60 s', 'now'],
  },
  labelOrder: 'value-last',
  sideTitle: 'EARLIER SURGES',
  sideItem: (ev) => ({ value: String(ev.value), title: ev.title }),

  pulse: {
    kicker: (ev) => (isSurge(ev) ? 'SUDDEN EDIT SURGE' : 'MOST EDITED · LAST 10 MIN'),
    layout: 'inline',
    note: 'When many people edit one article at once, something just happened in the world. This often shows up here before the headlines.',
    emptyText: 'Listening to every Wikipedia edit…',
    emptyKicker: 'LISTENING',
    pick(store, now) {
      const surge = store.important()[0];
      if (surge && now - surge.time < SURGE_HERO_MS) return surge;
      return current?.busiest() ?? surge;
    },
    value: (ev) => String(ev.value),
    subtitle: (ev) =>
      `edits in 10 min · ${editors(ev)} ${editors(ev) === 1 ? 'editor' : 'editors'} · ${ev.meta.wiki}`,
    linkText: 'Read the article',
    announce: (ev) =>
      isSurge(ev)
        ? `Edit surge on Wikipedia: ${ev.title}, ${ev.value} edits by ${editors(ev)} people in 10 minutes.`
        : `Most edited Wikipedia article right now: ${ev.title}.`,
  },

  stats(_store, now) {
    const rate = current?.editsPerSecond(now) ?? 0;
    const added = current?.bytesAdded(now) ?? 0;
    return [
      { label: 'Edits / second', value: rate.toFixed(1) },
      {
        label: 'Text added · 60 s',
        value: `${(added / 1000).toFixed(1)} kB`,
        color: palette.small,
      },
    ];
  },

  summary(store, now) {
    const live = store.inWindow(now).filter((e) => !isSurge(e));
    const rate = current?.editsPerSecond(now) ?? 0;
    return `About ${rate.toFixed(1)} Wikipedia edits per second. ${live.length} shown in the last 60 seconds. A surge means at least ${SURGE_MIN_EDITS} edits by ${SURGE_MIN_EDITORS} people to one article within ${SURGE_WINDOW_MS / 60_000} minutes.`;
  },

  start: (ctx) => startWikipedia(ctx, { retainSurgesMs: RETAIN_SURGES_MS }),
  startDemo(ctx) {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import('../../demo/generators').then((m) => {
      if (!cancelled) stop = m.startWikipediaDemo(ctx);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  },
};

export default wikipedia;
