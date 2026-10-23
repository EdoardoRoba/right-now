/**
 * Boot: header (pills, clock, status), router, Sources dialog, announcer,
 * and mounting the active channel view.
 */
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/animations.css';

import { channels, defaultChannel, type ChannelEntry } from './channels/registry';
import { mountClock } from './core/clock';
import { el, externalLink } from './core/dom';
import { renderTicker } from './core/ticker';
import type { Channel } from './core/types';
import { mountChannelView } from './core/view';
import { startRouter, type Route } from './router';

const $ = (id: string) => document.getElementById(id)!;

const demo = new URLSearchParams(location.search).get('demo') === '1';
$('demo-badge').hidden = !demo;

const view = $('view');
const nav = $('channels');
const ticker = $('ticker');
const tickerText = $('ticker-text');
const dialog = $('sources') as HTMLDialogElement;

mountClock($('clock'));

// Pause CSS loops while the tab is hidden.
document.addEventListener('visibilitychange', () => {
  document.documentElement.classList.toggle('is-hidden', document.hidden);
});

// ---- Announcer: at most one polite announcement per 20 s (latest wins) ----
const ANNOUNCE_GAP_MS = 20_000;
let lastAnnounce = 0;
let pendingAnnounce: ReturnType<typeof setTimeout> | undefined;
function announce(text: string): void {
  clearTimeout(pendingAnnounce);
  const wait = lastAnnounce + ANNOUNCE_GAP_MS - Date.now();
  const say = () => {
    lastAnnounce = Date.now();
    $('announcer').textContent = text;
  };
  if (wait <= 0) say();
  else pendingAnnounce = setTimeout(say, wait);
}

// ---- Channel pills ----
function renderNav(active?: ChannelEntry): void {
  nav.replaceChildren(
    ...channels.map((c) =>
      el(
        'a',
        {
          class: 'pill',
          href: c.path + location.search,
          'data-route': true,
          'aria-current': c === active ? 'page' : undefined,
        },
        c.name,
        ...(c.status === 'soon' ? [el('span', { class: 'pill__soon' }, 'soon')] : []),
      ),
    ),
  );
}

// ---- Sources dialog ----
function renderSources(channel: Channel | null): void {
  const body: Node[] = [el('h2', { id: 'sources-title' }, 'Sources')];
  if (channel) {
    body.push(el('p', { class: 'dialog__notice' }, channel.attribution));
    for (const s of channel.sources) {
      body.push(el('h3', {}, externalLink(s.url, {}, `${s.name} ↗`)), el('p', {}, s.terms));
    }
  }
  body.push(
    el(
      'p',
      {},
      'Right Now shows only real, openly licensed data and links every event to its official source. No cookies, no tracking. Full details: ',
      externalLink(
        'https://github.com/EdoardoRoba/right-now/blob/main/ATTRIBUTION.md',
        {},
        'ATTRIBUTION.md',
      ),
      '.',
    ),
  );
  const close = el('button', { class: 'dialog__close', type: 'button' }, 'Close');
  close.addEventListener('click', () => dialog.close());
  body.push(close);
  dialog.replaceChildren(...body);
}
$('sources-btn').addEventListener('click', () => dialog.showModal());
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close(); // click on the backdrop
});

// ---- Views ----
let unmount: (() => void) | null = null;
let generation = 0;

function setTicker(segments: string[]): void {
  renderTicker(ticker, tickerText, demo ? [...segments, 'DEMO DATA'] : segments);
}

function soonView(entry: ChannelEntry): void {
  view.replaceChildren(
    el(
      'div',
      { class: 'hero-row' },
      el(
        'section',
        { class: 'soon' },
        el('p', { class: 'pulse__kicker' }, `COMING IN ${entry.release ?? 'A LATER RELEASE'}`),
        el('h1', { class: 'soon__title' }, entry.name),
        el('p', { class: 'soon__text' }, entry.blurb ?? ''),
        el(
          'a',
          { class: 'soon__link', href: defaultChannel.path + location.search, 'data-route': true },
          `Watch ${defaultChannel.name.toLowerCase()} live now →`,
        ),
      ),
    ),
  );
  setTicker([`${entry.name.toUpperCase()} — COMING SOON`, 'REAL, OPEN DATA ONLY']);
  renderSources(null);
}

function notFoundView(): void {
  document.title = 'Not found — Right Now';
  view.replaceChildren(
    el(
      'div',
      { class: 'hero-row' },
      el(
        'section',
        { class: 'soon' },
        el('p', { class: 'pulse__kicker' }, '404'),
        el('h1', { class: 'soon__title' }, 'Nothing is happening here.'),
        el(
          'p',
          { class: 'soon__text' },
          'This page does not exist — but plenty is happening elsewhere.',
        ),
        el(
          'a',
          { class: 'soon__link', href: defaultChannel.path + location.search, 'data-route': true },
          `Watch ${defaultChannel.name.toLowerCase()} live →`,
        ),
      ),
    ),
  );
  setTicker(['PAGE NOT FOUND', 'REAL, OPEN DATA ONLY']);
  renderSources(null);
}

async function onRoute(route: Route): Promise<void> {
  const gen = ++generation;
  unmount?.();
  unmount = null;

  if (route.kind === 'not-found') {
    renderNav();
    notFoundView();
    return;
  }

  const entry = route.entry;
  renderNav(entry);
  document.title = `${entry.name} — Right Now`;
  if (entry.status === 'soon' || !entry.load) {
    soonView(entry);
    return;
  }

  const channel = await entry.load();
  if (gen !== generation) return; // user navigated away while loading
  setTicker([...channel.tagline, channel.attribution.toUpperCase()]);
  renderSources(channel);
  unmount = mountChannelView(view, channel, {
    demo,
    freshnessEl: $('freshness'),
    announce,
  });
}

startRouter((r) => void onRoute(r));
