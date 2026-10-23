/**
 * The river: a <canvas> where every event appears at the NOW line on the
 * right and drifts left as it ages. Channel-agnostic: it only reads
 * LiveEvent.time / y / size / color / important / label.
 *
 * Positions are recomputed from timestamps every frame, so motion is smooth,
 * real-time, and a hidden tab resumes without catch-up bursts.
 */
import { el, externalLink } from './dom';
import { fonts, palette } from './palette';
import type { EventStore, StoreChange } from './store';
import { formatAgo, formatUtcClock } from './time';
import type { Channel, LiveEvent } from './types';

const POP_MS = 700;
const RING_MS = 2000;
/** Dots fade out over the last 10% of the window. */
const FADE_FRACTION = 0.1;
/** Canvas extends past the river box so big glows aren't clipped. */
const BLEED = 40;
const LABEL_FONT_SIZE = 13;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** x in px for an event of age `age` in a river `width` px wide. */
export function xForAge(age: number, windowMs: number, width: number): number {
  return width * (1 - Math.min(Math.max(age, 0), windowMs) / windowMs);
}

/** 1 for most of the window, easing to 0 over the last 10%. */
export function fadeForAge(age: number, windowMs: number): number {
  const start = windowMs * (1 - FADE_FRACTION);
  if (age <= start) return 1;
  return Math.max(0, (windowMs - age) / (windowMs * FADE_FRACTION));
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Dot pop-in: scale 0 → 1.35 (at 70%) → 1 over 700 ms. */
export function popScale(life: number): number {
  if (life >= POP_MS) return 1;
  const t = Math.max(0, life / POP_MS);
  if (t < 0.7) return 1.35 * easeOut(t / 0.7);
  return 1.35 - 0.35 * easeOut((t - 0.7) / 0.3);
}

/** Ring: diameter factor 0.8× → 5× and alpha .9 → 0 over 2 s; null when done. */
export function ringAt(life: number): { scale: number; alpha: number } | null {
  if (life < 0 || life >= RING_MS) return null;
  const p = life / RING_MS;
  return { scale: 0.8 + 4.2 * easeOut(p), alpha: 0.9 * (1 - p) };
}

/** Vertical position in px for y ∈ [0, 1] inside a river `height` px tall. */
export function yToPx(y: number, height: number): number {
  const pad = Math.max(16, height * 0.1);
  return pad + Math.min(1, Math.max(0, y)) * (height - pad * 2);
}

// ---------------------------------------------------------------------------

interface Drawn {
  ev: LiveEvent;
  x: number;
  y: number;
  r: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RiverOptions {
  now: () => number;
  reducedMotion: () => boolean;
}

export class River {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tooltip: HTMLElement;
  private summary: HTMLElement;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private raf = 0;
  private interval: ReturnType<typeof setInterval> | undefined;
  private summaryTimer: ReturnType<typeof setInterval>;
  private bornAt = new Map<string, number>();
  private sprites = new Map<string, HTMLCanvasElement>();
  private labelWidths = new Map<string, [number, number, number]>();
  private drawn: Drawn[] = [];
  private pinned: LiveEvent | null = null;
  private resize: ResizeObserver;
  private unsubscribe: () => void;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: EventStore,
    private readonly channel: Channel,
    private readonly opts: RiverOptions,
  ) {
    root.classList.add('river');
    this.canvas = el('canvas', { class: 'river__canvas', 'aria-hidden': 'true' });
    this.canvas.style.inset = `-${BLEED}px 0`;
    this.canvas.style.height = `calc(100% + ${BLEED * 2}px)`;
    this.ctx = this.canvas.getContext('2d')!;
    this.tooltip = el('div', { class: 'tooltip', hidden: true });
    this.summary = el('p', { class: 'visually-hidden' });

    const grid = [0, 25, 50, 75].map((left) => {
      const g = el('div', { class: 'river__grid', 'aria-hidden': 'true' });
      g.style.left = `${left}%`;
      return g;
    });
    const axisTop = el('div', { class: 'river__axis river__axis--top', 'aria-hidden': 'true' });
    const axisBottom = el('div', {
      class: 'river__axis river__axis--bottom',
      'aria-hidden': 'true',
    });
    axisTop.textContent = channel.axis.top;
    axisBottom.textContent = channel.axis.bottom;
    if (channel.axis.topColor) axisTop.style.color = channel.axis.topColor;
    if (channel.axis.bottomColor) axisBottom.style.color = channel.axis.bottomColor;
    if (channel.axis.centerLine)
      grid.push(el('div', { class: 'river__center', 'aria-hidden': 'true' }));
    for (const y of channel.axis.guides ?? []) {
      const g = el('div', { class: 'river__guide', 'aria-hidden': 'true' });
      g.style.top = `${10 + y * 80}%`; // matches yToPx's 10% padding
      grid.push(g);
    }
    root.replaceChildren(
      ...grid,
      axisTop,
      axisBottom,
      this.canvas,
      el('div', { class: 'river__now', 'aria-hidden': 'true' }),
      el('div', { class: 'river__now-label', 'aria-hidden': 'true' }, 'NOW'),
      this.tooltip,
      this.summary,
    );

    // Events present before the river mounted (or from the first fill) don't pop.
    this.unsubscribe = store.subscribe((c) => this.onChange(c));

    this.resize = new ResizeObserver(() => this.measure());
    this.resize.observe(root);
    this.measure();

    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('click', this.onClick);
    this.tooltip.addEventListener('pointerleave', this.onPointerLeave);
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('pointerdown', this.onDocPointer);
    document.addEventListener('keydown', this.onKey);

    this.updateSummary();
    this.summaryTimer = setInterval(() => this.updateSummary(), 30_000);
    this.startLoop();
  }

  destroy(): void {
    this.stopLoop();
    clearInterval(this.summaryTimer);
    this.resize.disconnect();
    this.unsubscribe();
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('pointerdown', this.onDocPointer);
    document.removeEventListener('keydown', this.onKey);
  }

  /** Re-evaluates the frame loop (e.g. after the reduced-motion setting changes). */
  restart(): void {
    this.stopLoop();
    this.startLoop();
  }

  // ---- loop ---------------------------------------------------------------

  private startLoop(): void {
    if (document.hidden) return;
    if (this.opts.reducedMotion()) {
      this.draw();
      this.interval = setInterval(() => this.draw(), 1000);
    } else {
      const frame = () => {
        this.draw();
        this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    }
  }

  private stopLoop(): void {
    cancelAnimationFrame(this.raf);
    clearInterval(this.interval);
  }

  private onVisibility = () => {
    this.stopLoop();
    if (!document.hidden) this.startLoop();
  };

  private onChange(change: StoreChange): void {
    if (!change.initial) {
      const t = this.opts.now();
      for (const ev of change.added) this.bornAt.set(ev.id, t);
    }
    for (const ev of change.removed) {
      this.bornAt.delete(ev.id);
      this.labelWidths.delete(ev.id);
    }
    for (const ev of change.updated) this.labelWidths.delete(ev.id);
  }

  private measure(): void {
    const rect = this.root.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round((rect.height + BLEED * 2) * this.dpr);
    if (this.opts.reducedMotion()) this.draw();
  }

  // ---- drawing ------------------------------------------------------------

  private draw(): void {
    const { ctx, width: w, height: h, dpr } = this;
    if (!w || !h) return;
    const now = this.opts.now();
    const reduced = this.opts.reducedMotion();
    const windowMs = this.channel.windowMs;

    ctx.setTransform(dpr, 0, 0, dpr, 0, BLEED * dpr);
    ctx.clearRect(0, -BLEED, w, h + BLEED * 2);

    const events = this.store.inWindow(now);
    const drawn: Drawn[] = [];
    // Narrow rivers (phones) get proportionally smaller dots.
    const k = Math.min(1, Math.max(0.6, w / 1100));

    // Dots: oldest first so newer ones sit on top.
    for (const ev of events) {
      const age = now - ev.time;
      const alpha = fadeForAge(age, windowMs);
      if (alpha <= 0) continue;
      const x = xForAge(age, windowMs, w);
      const y = yToPx(ev.y, h);
      const born = this.bornAt.get(ev.id);
      const life = born === undefined ? Infinity : now - born;
      const scale = reduced ? 1 : popScale(life);
      const size = ev.size * k;
      const d = size * scale;
      if (d <= 0.1) continue;

      ctx.globalAlpha = alpha;
      const glowR = d * 1.4;
      ctx.drawImage(this.sprite(ev.color), x - glowR, y - glowR, glowR * 2, glowR * 2);
      ctx.fillStyle = ev.color;
      ctx.beginPath();
      if (ev.shape === 'square') ctx.roundRect(x - d / 2, y - d / 2, d, d, Math.min(3, d / 4));
      else ctx.arc(x, y, d / 2, 0, Math.PI * 2);
      ctx.fill();

      if (ev.important && !reduced) {
        const ring = ringAt(life);
        if (ring) {
          ctx.globalAlpha = alpha * ring.alpha;
          ctx.strokeStyle = ev.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, (size * ring.scale) / 2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      drawn.push({ ev, x, y, r: size / 2 });
    }

    this.drawLabels(drawn, now, windowMs);
    ctx.globalAlpha = 1;
    this.drawn = drawn;
  }

  /**
   * Labels, newest first: important dots get first pick of the space, then
   * dots the channel flags with `showLabel`. A label that would overlap one
   * already placed is skipped.
   */
  private drawLabels(drawn: Drawn[], now: number, windowMs: number): void {
    const { ctx, width: w } = this;
    const placed: Rect[] = [];
    const valueFont = `500 ${LABEL_FONT_SIZE}px ${fonts.mono}`;
    const textFont = `400 ${LABEL_FONT_SIZE}px ${fonts.display}`;
    const valueLast = this.channel.labelOrder === 'value-last';
    ctx.textBaseline = 'middle';

    for (const pass of [true, false]) {
      for (let i = drawn.length - 1; i >= 0; i--) {
        const { ev, x, y, r } = drawn[i]!;
        if (!ev.label || ev.important !== pass || (!pass && !ev.showLabel)) continue;
        const value = ev.labelValue ?? '';
        let widths = this.labelWidths.get(ev.id);
        if (!widths) {
          ctx.font = valueFont;
          const vw = value ? ctx.measureText(value).width : 0;
          ctx.font = textFont;
          widths = [vw, ctx.measureText(ev.label).width, ctx.measureText(' ').width];
          this.labelWidths.set(ev.id, widths);
        }
        const [vw, tw, space] = widths;
        const total = vw + tw + (value ? space : 0);
        let lx = x + r + 10;
        if (lx + total > w - 12) lx = x - r - 10 - total; // flip left near the NOW line
        const rect = { x: lx - 4, y: y - 10, w: total + 8, h: 20 };
        if (lx < 0 || placed.some((p) => overlaps(p, rect))) continue;
        placed.push(rect);

        const valueX = valueLast ? lx + tw + space : lx;
        const textX = valueLast || !value ? lx : lx + vw + space;
        ctx.globalAlpha = fadeForAge(now - ev.time, windowMs);
        // A thin background-coloured halo keeps labels legible over other dots.
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = palette.bg;
        if (value) {
          ctx.font = valueFont;
          ctx.strokeText(value, valueX, y);
          ctx.fillStyle = ev.labelColor ?? ev.color;
          ctx.fillText(value, valueX, y);
        }
        ctx.font = textFont;
        ctx.strokeText(ev.label, textX, y);
        ctx.fillStyle = palette.text;
        ctx.fillText(ev.label, textX, y);
      }
    }
  }

  /** Pre-rendered radial glow per colour (approximates the mockup's box-shadow). */
  private sprite(color: string): HTMLCanvasElement {
    let s = this.sprites.get(color);
    if (s) return s;
    const size = 128;
    s = document.createElement('canvas');
    s.width = s.height = size;
    const g = s.getContext('2d')!;
    const c = size / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, hexA(color, 0.55));
    grad.addColorStop(0.36, hexA(color, 0.45)); // ≈ the dot's edge
    grad.addColorStop(0.6, hexA(color, 0.16));
    grad.addColorStop(1, hexA(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    this.sprites.set(color, s);
    return s;
  }

  // ---- interaction --------------------------------------------------------

  private hit(clientX: number, clientY: number): Drawn | undefined {
    const rect = this.root.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let best: Drawn | undefined;
    let bestDist = Infinity;
    for (const d of this.drawn) {
      const dist = Math.hypot(d.x - px, d.y - py);
      if (dist <= Math.max(d.r, 10) + 4 && dist < bestDist) {
        best = d;
        bestDist = dist;
      }
    }
    return best;
  }

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || this.pinned) return;
    const d = this.hit(e.clientX, e.clientY);
    this.canvas.style.cursor = d ? 'pointer' : '';
    if (d) this.showTooltip(d);
    else this.tooltip.hidden = true;
  };

  private onPointerLeave = (e: PointerEvent) => {
    if (this.pinned) return;
    const to = e.relatedTarget as Node | null;
    if (to && (this.tooltip.contains(to) || to === this.canvas)) return;
    this.tooltip.hidden = true;
  };

  /** Tap / click pins the tooltip so its link can be followed on touch screens. */
  private onClick = (e: MouseEvent) => {
    const d = this.hit(e.clientX, e.clientY);
    if (d) {
      this.pinned = d.ev;
      this.showTooltip(d);
    } else {
      this.hideTooltip();
    }
  };

  private hideTooltip(): void {
    this.pinned = null;
    this.tooltip.hidden = true;
  }

  private onDocPointer = (e: PointerEvent) => {
    if (!this.root.contains(e.target as Node)) this.hideTooltip();
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.hideTooltip();
  };

  private showTooltip({ ev, x, y, r }: Drawn): void {
    const now = this.opts.now();
    const value = el('span', { class: 'tooltip__value' }, ev.labelValue ?? String(ev.value));
    value.style.color = ev.color;
    const children: Node[] = [
      el('div', {}, value, ' ', ev.title),
      el(
        'div',
        { class: 'tooltip__time' },
        `${formatUtcClock(ev.time)} UTC · ${formatAgo(now - ev.time)}`,
      ),
    ];
    if (ev.url) children.push(externalLink(ev.url, { class: 'tooltip__link' }, 'Open source ↗'));
    this.tooltip.replaceChildren(...children);
    this.tooltip.hidden = false;

    const tw = this.tooltip.offsetWidth;
    const th = this.tooltip.offsetHeight;
    let left = x + r + 12;
    if (left + tw > this.width) left = x - r - 12 - tw;
    const top = Math.min(Math.max(y - th / 2, -BLEED / 2), this.height - th + BLEED / 2);
    this.tooltip.style.left = `${Math.max(0, left)}px`;
    this.tooltip.style.top = `${top}px`;
  }

  private updateSummary(): void {
    this.summary.textContent = this.channel.summary(this.store, this.opts.now());
  }
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
