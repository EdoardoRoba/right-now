import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Freshness } from '../../core/freshness';
import { palette } from '../../core/palette';
import { EventStore } from '../../core/store';
import { SurgeDetector } from './surge';
import {
  MAX_DRAWN_PER_SEC,
  STREAM_URL,
  WikipediaRuntime,
  articleUrl,
  bytesColor,
  bytesToY,
  editToEvent,
  formatBytes,
  parseChange,
  current,
  startWikipedia,
  STALE_RESET_AFTER,
  type RawChange,
} from './source';

const fixture: RawChange[] = readFileSync(
  new URL('./fixtures/recentchange-10min.ndjson', import.meta.url),
  'utf8',
)
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

const edit = (over: Partial<RawChange> = {}): RawChange => ({
  meta: { id: 'e1', dt: '2026-10-23T07:00:00.000Z' },
  type: 'edit',
  namespace: 0,
  title: 'Mount Etna',
  server_name: 'it.wikipedia.org',
  bot: false,
  user: 'Some User',
  length: { old: 1000, new: 1250 },
  ...over,
});

describe('parseChange (filters)', () => {
  it('keeps Wikipedia article edits', () => {
    expect(parseChange(edit())).toMatchObject({
      id: 'e1',
      title: 'Mount Etna',
      serverName: 'it.wikipedia.org',
      bytes: 250,
      bot: false,
      time: Date.parse('2026-10-23T07:00:00.000Z'),
    });
  });

  it('drops other types, namespaces and wikis', () => {
    expect(parseChange(edit({ type: 'new' }))).toBeNull();
    expect(parseChange(edit({ type: 'log' }))).toBeNull();
    expect(parseChange(edit({ namespace: 1 }))).toBeNull(); // talk page
    expect(parseChange(edit({ server_name: 'www.wikidata.org' }))).toBeNull();
    expect(parseChange(edit({ server_name: 'commons.wikimedia.org' }))).toBeNull();
    expect(parseChange(edit({ server_name: 'en.wiktionary.org' }))).toBeNull();
  });

  it('handles missing lengths and timestamps', () => {
    expect(parseChange(edit({ length: { old: null, new: 300 } }))!.bytes).toBe(300);
    expect(parseChange(edit({ meta: { id: 'x' } }))).toBeNull();
  });
});

describe('mapping (mockup F)', () => {
  it('puts added text above the centre line and removed text below, on a log scale', () => {
    expect(bytesToY(0)).toBe(0.5);
    expect(bytesToY(100)).toBeLessThan(0.5);
    expect(bytesToY(-100)).toBeGreaterThan(0.5);
    expect(bytesToY(10_000)).toBeLessThan(bytesToY(100));
    expect(bytesToY(1e9)).toBeCloseTo(0, 5);
    expect(bytesToY(-1e9)).toBeCloseTo(1, 5);
  });

  it('colours additions blue, removals orange, bots dim', () => {
    expect(bytesColor(10, false)).toBe(palette.small);
    expect(bytesColor(-10, false)).toBe(palette.strong);
    expect(bytesColor(10, true)).toBe(palette.dim);
  });

  it('formats byte changes like the mockup', () => {
    expect(formatBytes(4213)).toBe('+4,213');
    expect(formatBytes(-567)).toBe('−567');
    expect(formatBytes(0)).toBe('+0');
  });

  it('links to the article', () => {
    expect(articleUrl('en.wikipedia.org', 'AC/DC (band)')).toBe(
      'https://en.wikipedia.org/wiki/AC%2FDC_(band)',
    );
  });

  it('labels big human edits only', () => {
    const big = editToEvent(parseChange(edit({ length: { old: 0, new: 5000 } }))!, 0);
    const bot = editToEvent(parseChange(edit({ bot: true, length: { old: 0, new: 5000 } }))!, 0);
    expect(big.showLabel).toBe(true);
    expect(big.labelValue).toBe('+5,000');
    expect(bot.showLabel).toBe(false);
  });
});

describe('privacy', () => {
  it('never puts usernames into events', () => {
    const rt = new WikipediaRuntime(new SurgeDetector({ minEdits: 2, minEditors: 2 }));
    const out = [
      ...rt.ingest(
        parseChange(edit({ user: 'Alice Secret', meta: { id: 'a', dt: '2026-10-23T07:00:00Z' } }))!,
        0,
      ),
      ...rt.ingest(
        parseChange(edit({ user: '192.0.2.44', meta: { id: 'b', dt: '2026-10-23T07:00:01Z' } }))!,
        1,
      ),
    ];
    expect(out.some((e) => e.important)).toBe(true);
    const text = JSON.stringify(out);
    expect(text).not.toContain('Alice');
    expect(text).not.toContain('192.0.2.44');
  });

  it('the recorded fixture carries no usernames', () => {
    expect(fixture.every((r) => r.user === undefined)).toBe(true);
  });
});

describe('WikipediaRuntime', () => {
  it('excludes bots from surge detection', () => {
    const rt = new WikipediaRuntime(new SurgeDetector({ minEdits: 3, minEditors: 1 }));
    for (let i = 0; i < 10; i++) {
      const out = rt.ingest(
        parseChange(
          edit({ bot: true, user: `bot${i}`, meta: { id: `b${i}`, dt: '2026-10-23T07:00:00Z' } }),
        )!,
        i * 1000,
      );
      expect(out.some((e) => e.important)).toBe(false);
    }
  });

  it('samples drawing but counts every edit in the stats', () => {
    const rt = new WikipediaRuntime();
    let drawn = 0;
    for (let i = 0; i < 200; i++) {
      drawn += rt.ingest(
        parseChange(
          edit({
            user: `u${i}`,
            title: `T${i}`,
            meta: { id: `x${i}`, dt: '2026-10-23T07:00:00Z' },
          }),
        )!,
        1000,
      ).length;
    }
    expect(drawn).toBe(MAX_DRAWN_PER_SEC);
    expect(rt.editsPerSecond(1000)).toBe(40); // 200 edits / 5 s
    expect(rt.bytesAdded(1000)).toBe(200 * 250);
    expect(rt.editsPerSecond(7000)).toBe(0);
    expect(rt.bytesAdded(62_000)).toBe(0);
  });

  it('replays the recorded stream without errors and finds a busiest article', () => {
    const rt = new WikipediaRuntime();
    let events = 0;
    for (const raw of fixture) {
      const e = parseChange(raw);
      expect(e).not.toBeNull(); // the recorder already filtered
      events += rt.ingest(e!, e!.time).length;
    }
    expect(events).toBeGreaterThan(100);
    const busy = rt.busiest();
    expect(busy).toBeDefined();
    expect(Number(busy!.meta.editors)).toBeGreaterThanOrEqual(2);
    expect(busy!.url).toMatch(/^https:\/\/[a-z-]+\.wikipedia\.org\/wiki\//);
  });
});

describe('startWikipedia (EventSource lifecycle)', () => {
  class FakeES {
    static all: FakeES[] = [];
    readyState = 1;
    onmessage: ((m: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public url: string) {
      FakeES.all.push(this);
    }
    close() {
      this.readyState = 2;
    }
  }
  afterEach(() => {
    FakeES.all = [];
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ingests messages, reports reconnecting, and resumes with a bounded ?since=', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    let t = Date.parse('2026-10-23T07:00:10Z');
    const store = new EventStore({ windowMs: 60_000 });
    const freshness = new Freshness(5_000, t);
    const stop = startWikipedia(
      { store, freshness },
      {
        EventSourceImpl: FakeES as unknown as typeof EventSource,
        now: () => t,
        retainSurgesMs: 3_600_000,
      },
    );
    expect(FakeES.all[0]!.url).toBe(STREAM_URL);

    FakeES.all[0]!.onmessage!({
      data: JSON.stringify(edit({ meta: { id: 'm1', dt: '2026-10-23T07:00:09Z' } })),
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(store.get('m1')).toBeDefined();
    expect(freshness.state(t)).toBe('live');

    // connection closed for good → reconnecting, then reopen from the last event
    FakeES.all[0]!.readyState = 2;
    FakeES.all[0]!.onerror!();
    expect(freshness.state(t)).toBe('reconnecting');
    t += 5_000;
    await vi.advanceTimersByTimeAsync(2_100);
    expect(FakeES.all).toHaveLength(2);
    expect(FakeES.all[1]!.url).toBe(`${STREAM_URL}?since=2026-10-23T07%3A00%3A09.000Z`);

    // a long outage never replays more than 30 s
    FakeES.all[1]!.readyState = 2;
    FakeES.all[1]!.onerror!();
    t += 10 * 60_000;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(FakeES.all[2]!.url).toBe(
      `${STREAM_URL}?since=${encodeURIComponent(new Date(t - 30_000).toISOString())}`,
    );
    stop();
    expect(FakeES.all[2]!.readyState).toBe(2);
  });

  it('never draws or counts a replay of old history, and reconnects fresh', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    const t = Date.parse('2026-10-23T08:44:50Z');
    const store = new EventStore({ windowMs: 60_000 });
    const freshness = new Freshness(5_000, t);
    const stop = startWikipedia(
      { store, freshness },
      {
        EventSourceImpl: FakeES as unknown as typeof EventSource,
        now: () => t,
        retainSurgesMs: 3_600_000,
      },
    );
    // 9-day-old edits arriving at full speed (what a numeric ?since= caused)
    for (let i = 0; i < STALE_RESET_AFTER; i++) {
      FakeES.all[0]!.onmessage!({
        data: JSON.stringify(
          edit({
            user: `u${i}`,
            title: 'Old',
            meta: { id: `old${i}`, dt: '2026-10-14T10:15:00Z' },
          }),
        ),
      });
    }
    await vi.advanceTimersByTimeAsync(300);
    expect(store.size).toBe(0);
    expect(current!.editsPerSecond(t)).toBe(0);
    expect(freshness.state(t)).toBe('reconnecting');
    expect(FakeES.all[0]!.readyState).toBe(2); // dropped
    expect(FakeES.all[1]!.url).toBe(STREAM_URL); // fresh, live position
    stop();
  });
});
