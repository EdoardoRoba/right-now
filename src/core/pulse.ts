/**
 * The Pulse: the single most important recent event, shown huge, with
 * shockwave rings and a live "x s ago" counter. A new hero blurs the old one
 * away and slides in; an in-place revision just updates the text.
 */
import { el, externalLink } from './dom';
import type { EventStore } from './store';
import { agoRefreshMs, formatAgo } from './time';
import type { LiveEvent, PulseConfig } from './types';

export interface PulseOptions {
  now: () => number;
  /** Called with a sentence when a NEW hero arrives (not on first render). */
  announce?: (text: string) => void;
}

export class Pulse {
  private hero: LiveEvent | undefined;
  /** Snapshot of the hero fields we render, to detect in-place revisions. */
  private heroKey = '';
  private stage: HTMLElement;
  private ago: HTMLElement;
  private kicker: HTMLElement;
  private rings: HTMLElement[];
  private fill: HTMLElement | null = null;
  private footer: HTMLElement;
  private agoTimer: ReturnType<typeof setTimeout> | undefined;
  private rendered = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly config: PulseConfig,
    private readonly opts: PulseOptions,
  ) {
    root.classList.add('pulse');
    this.rings = [0, 1, 2].map(() => el('div', { class: 'pulse__ring' }));
    this.ago = el('span', { class: 'pulse__ago' }, '—');
    this.stage = el('div', { class: 'pulse__stage' });
    this.footer = el('div', { class: 'pulse__footer' });
    this.kicker = el('span', {}, typeof config.kicker === 'string' ? config.kicker : '');
    if (config.layout === 'inline') root.classList.add('pulse--inline');

    const parts: Node[] = [
      el('div', { class: 'pulse__rings', 'aria-hidden': 'true' }, ...this.rings),
      el('p', { class: 'pulse__kicker' }, this.kicker, ' · ', this.ago),
      this.stage,
    ];
    if (config.bar) {
      this.fill = el('div', { class: 'pulse__fill' });
      const scale = el('div', { class: 'pulse__scale', 'aria-hidden': 'true' });
      for (const l of config.bar.labels) {
        const span = el('span', {}, l.text);
        span.style.left = `${l.at}%`;
        scale.append(span);
      }
      parts.push(
        el('div', { class: 'pulse__bar' }, el('div', { class: 'pulse__track' }, this.fill), scale),
      );
    }
    if (config.note) parts.push(el('p', { class: 'pulse__note' }, config.note));
    parts.push(this.footer);
    root.replaceChildren(...parts);
    this.showEmpty();
    this.tickAgo();
  }

  /** Re-picks the hero from the store; swaps or refreshes as needed. */
  update(store: EventStore): void {
    const now = this.opts.now();
    const next = this.config.pick ? this.config.pick(store, now) : store.important()[0];
    if (!next) {
      if (this.hero) this.showEmpty();
      this.hero = undefined;
      this.heroKey = '';
      return;
    }
    const key = this.keyOf(next);
    if (this.hero && next.id === this.hero.id) {
      if (key !== this.heroKey) this.refresh(next);
    } else {
      const isNew = this.rendered && this.hero !== undefined;
      this.swap(next);
      if (isNew) this.opts.announce?.(this.config.announce(next));
    }
    this.hero = next;
    this.heroKey = key;
    this.rendered = true;
  }

  get heroId(): string | undefined {
    return this.hero?.id;
  }

  destroy(): void {
    clearTimeout(this.agoTimer);
  }

  // -------------------------------------------------------------------------

  private keyOf(ev: LiveEvent): string {
    return [ev.value, ev.title, ev.time, ev.color, ev.url, JSON.stringify(ev.meta)].join('|');
  }

  private buildHero(ev: LiveEvent): HTMLElement {
    const c = this.config;
    return el(
      'div',
      { class: 'pulse__hero pulse__hero--in' },
      el(
        'p',
        { class: c.valueMuted?.(ev) ? 'pulse__number pulse__number--muted' : 'pulse__number' },
        c.value(ev),
      ),
      el(
        'div',
        { class: 'pulse__text' },
        el('h2', { class: 'pulse__title' }, ev.title),
        ...(c.detail ? [el('p', { class: 'pulse__detail' }, c.detail(ev))] : []),
        el('p', { class: 'pulse__subtitle' }, c.subtitle(ev)),
      ),
    );
  }

  private swap(ev: LiveEvent): void {
    this.stage.querySelector('.pulse__empty')?.remove();
    for (const old of this.stage.querySelectorAll('.pulse__hero')) {
      old.classList.remove('pulse__hero--in');
      old.classList.add('pulse__hero--out');
      old.setAttribute('aria-hidden', 'true');
      setTimeout(() => old.remove(), 550);
    }
    this.stage.append(this.buildHero(ev));
    this.applyMeta(ev);
    this.fireRings();
  }

  /** Same event, revised by the source (e.g. a magnitude update). */
  private refresh(ev: LiveEvent): void {
    const current = this.stage.querySelector('.pulse__hero:not(.pulse__hero--out)');
    if (current) {
      const number = current.querySelector('.pulse__number')!;
      number.textContent = this.config.value(ev);
      number.classList.toggle('pulse__number--muted', this.config.valueMuted?.(ev) ?? false);
      current.querySelector('.pulse__title')!.textContent = ev.title;
      current.querySelector('.pulse__subtitle')!.textContent = this.config.subtitle(ev);
      const detail = current.querySelector('.pulse__detail');
      if (detail && this.config.detail) detail.textContent = this.config.detail(ev);
    }
    this.applyMeta(ev);
  }

  private applyMeta(ev: LiveEvent): void {
    this.root.style.setProperty('--hero-color', ev.color);
    if (typeof this.config.kicker === 'function') this.kicker.textContent = this.config.kicker(ev);
    if (this.fill && this.config.bar) this.fill.style.width = `${this.config.bar.pct(ev)}%`;
    const tags = this.config.tags?.(ev) ?? [];
    this.footer.replaceChildren(
      ...tags.map((t) => {
        const cls = `tag tag--${t.tone ?? 'info'}`;
        return t.href
          ? externalLink(t.href, { class: cls }, t.text)
          : el('span', { class: cls }, t.text);
      }),
      ...(ev.url
        ? [externalLink(ev.url, { class: 'pulse__link' }, `${this.config.linkText} ↗`)]
        : []),
    );
  }

  private showEmpty(): void {
    this.stage.replaceChildren(el('p', { class: 'pulse__empty' }, this.config.emptyText));
    if (typeof this.config.kicker === 'function')
      this.kicker.textContent = this.config.emptyKicker ?? '';
    this.root.style.removeProperty('--hero-color');
    if (this.fill) this.fill.style.width = '0%';
    this.footer.replaceChildren();
    this.ago.textContent = '—';
  }

  private fireRings(): void {
    for (const r of this.rings) {
      r.classList.remove('pulse__ring--go');
      void r.offsetWidth; // restart the CSS animation
      r.classList.add('pulse__ring--go');
    }
  }

  /** 100 ms updates under a minute, then once a second. */
  private tickAgo = (): void => {
    let delay = 1000;
    if (this.hero) {
      const age = this.opts.now() - this.hero.time;
      this.ago.textContent = formatAgo(age);
      delay = agoRefreshMs(age);
    }
    this.agoTimer = setTimeout(this.tickAgo, delay);
  };
}
