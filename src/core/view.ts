/**
 * Composes one channel's screen: Pulse + side column + river + ticks, wires
 * them to a fresh EventStore and starts the channel's data source.
 */
import { el } from './dom';
import { Freshness } from './freshness';
import { onReducedMotionChange, prefersReducedMotion } from './motion';
import { Pulse } from './pulse';
import { River } from './river';
import { SideList } from './sidelist';
import { EventStore } from './store';
import { formatAgoShort, systemClock, type Clock } from './time';
import type { Channel } from './types';

export interface ViewOptions {
  demo: boolean;
  clock?: Clock;
  /** Header element showing "Updated 12 s ago" / "Data delayed". */
  freshnessEl: HTMLElement;
  announce: (text: string) => void;
}

export function mountChannelView(
  root: HTMLElement,
  channel: Channel,
  opts: ViewOptions,
): () => void {
  const clock = opts.clock ?? systemClock;
  const now = () => clock.now();

  const store = new EventStore({
    windowMs: channel.windowMs,
    retainImportantMs: channel.retainImportantMs,
  });
  const freshness = new Freshness(channel.pollMs, now());

  // ---- DOM ----
  const pulseEl = el('section', { 'aria-label': `Latest notable event: ${channel.name}` });
  const sideEl = el('aside', { 'aria-label': 'Live stats and earlier notable events' });
  const riverEl = el('div', {});
  const ticks = (list: string[], cls: string) =>
    el(
      'div',
      { class: `river__ticks ${cls}`, 'aria-hidden': 'true' },
      ...list.map((t) => el('span', {}, t)),
    );

  root.replaceChildren(
    el('h1', { class: 'visually-hidden' }, `${channel.name}, live`),
    el('div', { class: 'hero-row' }, pulseEl, sideEl),
    el(
      'div',
      { class: 'river-wrap' },
      riverEl,
      ticks(channel.axis.ticks, 'river__ticks--desktop'),
      ticks(channel.axis.mobileTicks, 'river__ticks--mobile'),
    ),
  );

  const pulse = new Pulse(pulseEl, channel.pulse, { now, announce: opts.announce });
  const side = new SideList(sideEl, channel);
  const river = new River(riverEl, store, channel, { now, reducedMotion: prefersReducedMotion });

  const refresh = () => {
    pulse.update(store);
    side.update(store, pulse.heroId, now());
  };
  const unsubscribe = store.subscribe(refresh);
  refresh();

  // ---- Freshness label ----
  const renderFreshness = () => {
    const t = now();
    const state = freshness.state(t);
    const f = opts.freshnessEl;
    if (state === 'delayed') {
      f.className = 'chip chip--delayed';
      f.textContent = 'Data delayed — source unreachable';
    } else {
      f.className = 'freshness';
      f.textContent =
        state === 'live' && freshness.lastSuccess !== null
          ? `Updated ${formatAgoShort(t - freshness.lastSuccess)}`
          : 'Connecting…';
    }
  };
  const unsubFresh = freshness.subscribe(renderFreshness);
  renderFreshness();

  // Once a second: ages, stats, freshness, pruning.
  const tick = setInterval(() => {
    const t = now();
    store.prune(t);
    side.tick(t, store);
    renderFreshness();
  }, 1000);

  const unsubMotion = onReducedMotionChange(() => river.restart());

  const ctx = { store, freshness };
  const stop = opts.demo && channel.startDemo ? channel.startDemo(ctx) : channel.start(ctx);

  return () => {
    stop();
    clearInterval(tick);
    unsubscribe();
    unsubFresh();
    unsubMotion();
    pulse.destroy();
    river.destroy();
    opts.freshnessEl.textContent = '';
    opts.freshnessEl.className = 'freshness';
  };
}
