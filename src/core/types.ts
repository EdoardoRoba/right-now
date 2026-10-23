/**
 * The shared model. Every source is normalised into `LiveEvent`, so the river,
 * the Pulse and the side list never need to know which channel they render.
 */
import type { EventStore } from './store';
import type { Freshness } from './freshness';

export type ChannelId = 'earthquakes' | 'wikipedia' | 'exploited';

export interface LiveEvent {
  /** Stable source id, used for dedupe. */
  id: string;
  channel: ChannelId;
  /** Epoch ms of when the event HAPPENED (source timestamp). */
  time: number;
  /** Epoch ms when we first saw it. Preserved across in-place updates. */
  receivedAt: number;
  /** e.g. place name, article title, product. */
  title: string;
  /** The main number: magnitude, edit count, CVSS score. */
  value: number;
  /** 0..1 vertical position in the river (0 = top). The channel decides the meaning. */
  y: number;
  /** Dot DIAMETER in CSS px (matches the mockups' `width: size px`). */
  size: number;
  /** Resolved hex colour (one of the palette tokens). */
  color: string;
  /** Can become the Pulse; gets a ring + label in the river. */
  important: boolean;
  /** Text shown next to important dots, e.g. "M4.6 Central Chile". */
  label?: string;
  /** The short value part of the label, drawn in mono and in the dot colour. */
  labelValue?: string;
  /** Link to the official source page for this event. */
  url?: string;
  meta: Record<string, string | number | boolean>;
}

export interface Stat {
  label: string;
  value: string;
  color?: string;
}

export interface PulseTag {
  text: string;
  href?: string;
}

/** How the generic Pulse renders a channel's hero event. */
export interface PulseConfig {
  /** Uppercase kicker before the "ago" counter, e.g. "LATEST M2.5+". */
  kicker: string;
  /** Shown when there is no hero yet. */
  emptyText: string;
  /** Picks the hero. Default: the newest important event. */
  pick?(store: EventStore, now: number): LiveEvent | undefined;
  value(ev: LiveEvent): string;
  subtitle(ev: LiveEvent): string;
  /** Optional 0..100 bar under the hero, with labels underneath. */
  bar?: { pct(ev: LiveEvent): number; labels: { text: string; at: number }[] };
  tags?(ev: LiveEvent): PulseTag[];
  linkText: string;
  /** Sentence for the aria-live announcer. */
  announce(ev: LiveEvent): string;
}

/** One row in the side list. */
export interface SideItem {
  value: string;
  title: string;
}

export interface ChannelContext {
  store: EventStore;
  freshness: Freshness;
}

export interface Channel {
  id: ChannelId;
  /** Menu label. */
  name: string;
  /** Ticker segments (joined with ● in the marquee). */
  tagline: string[];
  /** Exact required notices, shown in the ticker and the Sources dialog. */
  attribution: string;
  /** Longer plain-language source notes for the Sources dialog. */
  sources: { name: string; url: string; terms: string }[];
  /** River time span. */
  windowMs: number;
  /** How long important events are kept for the Pulse/side list (≥ windowMs). */
  retainImportantMs: number;
  /** Expected update interval; drives the "data delayed" badge (3×). */
  pollMs: number;
  axis: { top: string; bottom: string; ticks: string[]; mobileTicks: string[] };
  /** Side list heading, e.g. "BEFORE THAT". */
  sideTitle: string;
  sideItem(ev: LiveEvent): SideItem;
  /** Accessible summary of the river, refreshed periodically. */
  summary(store: EventStore, now: number): string;
  /** Begins polling/streaming; returns a stop function. */
  start(ctx: ChannelContext): () => void;
  /** Dev-only fake data for ?demo=1. */
  startDemo?(ctx: ChannelContext): () => void;
  pulse: PulseConfig;
  /** The 2 small live stats in the side column. */
  stats(store: EventStore, now: number): Stat[];
}
