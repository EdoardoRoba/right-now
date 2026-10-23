import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { palette } from '../../core/palette';
import { EventStore } from '../../core/store';
import { Freshness } from '../../core/freshness';
import {
  FEED_BASE,
  depthToY,
  featureToEvent,
  fetchFeed,
  isImportant,
  magColor,
  magSize,
  parseFeed,
  startUsgs,
} from './source';

const FIXTURES = new URL('./fixtures/', import.meta.url);
const load = (name: string) => JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8'));
const sample = load('synthetic-sample.geojson');
const RECEIVED = 1_761_200_000_000;

describe('mapping', () => {
  it('colours by magnitude band (mockup D)', () => {
    expect(magColor(1.2)).toBe(palette.small);
    expect(magColor(2.99)).toBe(palette.small);
    expect(magColor(3)).toBe(palette.mid);
    expect(magColor(4.9)).toBe(palette.mid);
    expect(magColor(5)).toBe(palette.strong);
    expect(magColor(7.8)).toBe(palette.strong);
  });

  it('sizes dots as 6 + mag² × 1.5, clamped', () => {
    expect(magSize(0)).toBe(6);
    expect(magSize(-1)).toBe(6); // negative magnitudes don't grow
    expect(magSize(2)).toBe(12);
    expect(magSize(4)).toBe(30);
    expect(magSize(9.5)).toBe(80); // clamp
  });

  it('maps depth on a sqrt scale, shallow at the top', () => {
    expect(depthToY(0)).toBe(0);
    expect(depthToY(-3)).toBe(0);
    expect(depthToY(700)).toBe(1);
    expect(depthToY(1200)).toBe(1);
    // 70 km lands ~32% down, not squashed into the top 10%
    expect(depthToY(70)).toBeCloseTo(0.316, 2);
    expect(depthToY(10)).toBeLessThan(depthToY(35));
  });

  it('marks M2.5+ as important, comparing the magnitude as displayed', () => {
    expect(isImportant(2.5)).toBe(true);
    expect(isImportant(2.47)).toBe(true); // shown as 2.5
    expect(isImportant(2.44)).toBe(false); // shown as 2.4
    expect(isImportant(6)).toBe(true);
  });
});

describe('parseFeed', () => {
  const events = parseFeed(sample, RECEIVED);
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));

  it('keeps earthquakes only and skips events without a magnitude', () => {
    expect(byId.xx0006).toBeUndefined(); // quarry blast
    expect(byId.xx0007).toBeUndefined(); // null mag
    expect(events).toHaveLength(11);
  });

  it('normalises a feature into a LiveEvent', () => {
    const ev = byId.xx0002!;
    expect(ev).toMatchObject({
      channel: 'earthquakes',
      title: 'Offshore Test Region A',
      value: 4.6,
      important: true,
      color: palette.mid,
      label: 'Offshore Test Region A',
      labelValue: 'M4.6',
      receivedAt: RECEIVED,
      url: 'https://earthquake.usgs.gov/earthquakes/eventpage/xx0002',
    });
    expect(ev.time).toBe(sample.features[1].properties.time);
    expect(ev.meta).toMatchObject({
      depthKm: 12,
      depthKnown: true,
      tsunami: false,
      status: 'reviewed',
    });
  });

  it('rounds magnitudes to one decimal', () => {
    expect(byId.xx0003!.value).toBe(2.5);
    expect(byId.xx0003!.important).toBe(true);
    expect(byId.xx0004!.value).toBe(2.4);
    expect(byId.xx0004!.important).toBe(false);
  });

  it('flags tsunami information', () => {
    expect(byId.xx0008!.meta.tsunami).toBe(true);
    expect(byId.xx0008!.color).toBe(palette.strong);
    expect(byId.xx0008!.y).toBeGreaterThan(0.9);
  });

  it('falls back to the title when place is missing', () => {
    expect(byId.xx0009!.title).toBe('Test Basin Region D');
  });

  it('handles unknown and above-sea-level depths', () => {
    expect(byId.xx0010!.meta.depthKnown).toBe(false);
    expect(byId.xx0010!.y).toBe(0);
    expect(byId.xx0011!.y).toBe(0);
  });

  it('drops links that do not point at usgs.gov', () => {
    expect(byId.xx0011!.url).toBeUndefined();
  });

  it('rejects documents without features', () => {
    expect(() => parseFeed({}, RECEIVED)).toThrow();
    expect(() => parseFeed(null, RECEIVED)).toThrow();
  });

  it('ignores malformed features', () => {
    expect(featureToEvent({}, RECEIVED)).toBeNull();
    expect(
      featureToEvent({ id: 'x', properties: { type: 'earthquake', mag: 2 } }, RECEIVED),
    ).toBeNull();
  });
});

const real = readdirSync(FIXTURES).filter((f) => /^usgs-.*\.geojson$/.test(f));
describe.skipIf(!real.length)('recorded real fixtures', () => {
  it.each(real)('%s parses cleanly', (name) => {
    const events = parseFeed(load(name), RECEIVED);
    for (const ev of events) {
      expect(ev.y).toBeGreaterThanOrEqual(0);
      expect(ev.y).toBeLessThanOrEqual(1);
      expect(ev.size).toBeGreaterThanOrEqual(6);
      expect(Number.isFinite(ev.time)).toBe(true);
    }
  });
});

describe('fetching & polling', () => {
  const okResponse = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  it('requests the feed with browser revalidation', async () => {
    const fetchImpl = vi.fn(async () => okResponse(sample));
    const events = await fetchFeed('all_hour', RECEIVED, fetchImpl as unknown as typeof fetch);
    expect(events.length).toBe(11);
    expect(fetchImpl).toHaveBeenCalledWith(`${FEED_BASE}all_hour.geojson`, { cache: 'no-cache' });
  });

  it('throws on HTTP errors', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }) as Response);
    await expect(fetchFeed('all_day', RECEIVED, fetchImpl)).rejects.toThrow('503');
  });

  it('fills from the past-day feed first, then polls the past hour', async () => {
    vi.useFakeTimers();
    const now = () => RECEIVED;
    const store = new EventStore({ windowMs: 3_600_000, retainImportantMs: 86_400_000 });
    const freshness = new Freshness(60_000, RECEIVED);
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      return okResponse(sample);
    });
    const stop = startUsgs(
      { store, freshness },
      { fetchImpl: fetchImpl as unknown as typeof fetch, now },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toEqual([`${FEED_BASE}all_day.geojson`]);
    expect(freshness.lastSuccess).toBe(RECEIVED);
    expect(store.size).toBe(11); // includes xx0012: 2 h old but important, kept for the Pulse
    await vi.advanceTimersByTimeAsync(60_000);
    expect(urls[1]).toBe(`${FEED_BASE}all_hour.geojson`);
    stop();
    vi.useRealTimers();
  });

  it('backs off and marks errors on failure', async () => {
    vi.useFakeTimers();
    const store = new EventStore({ windowMs: 3_600_000 });
    const freshness = new Freshness(60_000, 0);
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = startUsgs({ store, freshness }, { fetchImpl, now: () => 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(freshness.lastError).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // backed off to 2 min
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    stop();
    warn.mockRestore();
    vi.useRealTimers();
  });
});
