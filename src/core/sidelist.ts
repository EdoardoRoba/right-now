/**
 * Side column: the 2 live stats and the earlier important events, fading as
 * they get older. Every row is a real link to the official source page.
 */
import { el, externalLink } from './dom';
import type { EventStore } from './store';
import { formatAgoShort } from './time';
import type { Channel, LiveEvent } from './types';

const MAX_ITEMS = 5;

export class SideList {
  private statsEl: HTMLElement;
  private listEl: HTMLOListElement;
  private items: { ev: LiveEvent; ago: HTMLElement }[] = [];

  constructor(
    root: HTMLElement,
    private readonly channel: Channel,
  ) {
    root.classList.add('side');
    this.statsEl = el('div', { class: 'stats' });
    const titleId = `side-title-${channel.id}`;
    this.listEl = el('ol', { class: 'side__list', 'aria-labelledby': titleId });
    root.replaceChildren(
      this.statsEl,
      el('h2', { class: 'side__title', id: titleId }, channel.sideTitle),
      this.listEl,
    );
  }

  update(store: EventStore, heroId: string | undefined, now: number): void {
    this.renderStats(store, now);
    const earlier = store
      .important()
      .filter((e) => e.id !== heroId)
      .slice(0, MAX_ITEMS);

    if (!earlier.length) {
      this.items = [];
      this.listEl.replaceChildren(el('li', { class: 'side__empty' }, 'Nothing earlier yet.'));
      return;
    }

    this.items = earlier.map((ev) => ({ ev, ago: el('span', { class: 'side__ago' }) }));
    this.listEl.replaceChildren(
      ...this.items.map(({ ev, ago }, i) => {
        const item = this.channel.sideItem(ev);
        const value = el('span', { class: 'side__value' }, item.value);
        value.style.color = ev.color;
        const name = el('span', { class: 'side__name' }, item.title);
        // Older rows fade, but text never drops below WCAG contrast:
        // names blend toward --faint (4.5:1) and the large values stay ≥ 3:1.
        name.style.color = `color-mix(in srgb, var(--faint) ${i * 25}%, var(--text))`;
        value.style.opacity = (1 - i * 0.085).toFixed(2);
        const children = [value, name, ago];
        const row = ev.url
          ? externalLink(ev.url, { class: 'side__item' }, ...children)
          : el('div', { class: 'side__item' }, ...children);
        return el('li', {}, row);
      }),
    );
    this.tick(now);
  }

  /** Refreshes the "ago" labels and stats; called once a second. */
  tick(now: number, store?: EventStore): void {
    for (const { ev, ago } of this.items) ago.textContent = formatAgoShort(now - ev.time);
    if (store) this.renderStats(store, now);
  }

  private renderStats(store: EventStore, now: number): void {
    const stats = this.channel.stats(store, now);
    const existing = this.statsEl.querySelectorAll<HTMLElement>('.stat__value');
    if (existing.length === stats.length) {
      stats.forEach((s, i) => {
        const v = existing[i]!;
        if (v.textContent !== s.value) v.textContent = s.value;
        v.style.color = s.color ?? '';
      });
      return;
    }
    this.statsEl.replaceChildren(
      ...stats.map((s) => {
        const v = el('div', { class: 'stat__value' }, s.value);
        if (s.color) v.style.color = s.color;
        return el('div', { class: 'stat' }, el('div', { class: 'stat__label' }, s.label), v);
      }),
    );
  }
}
