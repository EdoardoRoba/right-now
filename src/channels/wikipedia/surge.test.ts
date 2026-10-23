import { describe, expect, it } from 'vitest';
import { SURGE_MIN_EDITORS, SURGE_MIN_EDITS, SURGE_WINDOW_MS, SurgeDetector } from './surge';

const MIN = 60_000;
const T0 = 1_000_000_000;

/** n edits to one article, cycling through `editors` people, `gap` ms apart. */
function burst(d: SurgeDetector, key: string, n: number, editors: number, gap = 1000, start = T0) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(d.add({ key, time: start + i * gap, editor: i % editors }));
  return out;
}

describe('SurgeDetector (thresholds from the brief)', () => {
  it('uses ≥ 15 edits by ≥ 5 editors in 10 minutes', () => {
    expect(SURGE_MIN_EDITS).toBe(15);
    expect(SURGE_MIN_EDITORS).toBe(5);
    expect(SURGE_WINDOW_MS).toBe(10 * MIN);
  });

  it('fires exactly when both thresholds are met', () => {
    const d = new SurgeDetector();
    const res = burst(d, 'en|Comet', 15, 5);
    expect(res.slice(0, 14).every((r) => r === null)).toBe(true);
    expect(res[14]).toMatchObject({ key: 'en|Comet', edits: 15, editors: 5, isNew: true });
  });

  it('needs enough distinct editors — one person editing a lot is not a surge', () => {
    const d = new SurgeDetector();
    expect(burst(d, 'en|Sandbox', 40, 1).every((r) => r === null)).toBe(true);
    expect(burst(d, 'en|Pair', 40, 4).every((r) => r === null)).toBe(true);
  });

  it('only counts edits inside the sliding window', () => {
    const d = new SurgeDetector();
    // 15 edits by 5 people, but spread over 15 minutes: never 15 inside 10 min
    expect(burst(d, 'en|Slow', 15, 5, MIN).every((r) => r === null)).toBe(true);
  });

  it('keeps one id per episode and updates the counts', () => {
    const d = new SurgeDetector();
    const res = burst(d, 'it|Etna', 20, 6);
    const first = res[14]!;
    const last = res[19]!;
    expect(last.id).toBe(first.id);
    expect(last.isNew).toBe(false);
    expect(last.edits).toBe(20);
    expect(last.editors).toBe(6);
  });

  it('starts a new episode after the article calms down', () => {
    const d = new SurgeDetector();
    const a = burst(d, 'it|Etna', 15, 5)[14]!;
    d.prune(T0 + 30 * MIN);
    const b = burst(d, 'it|Etna', 15, 5, 1000, T0 + 31 * MIN)[14]!;
    expect(b.isNew).toBe(true);
    expect(b.id).not.toBe(a.id);
  });

  it('forgets idle articles when pruned (no memory growth)', () => {
    const d = new SurgeDetector();
    for (let i = 0; i < 500; i++) d.add({ key: `en|A${i}`, time: T0, editor: 1 });
    expect(d.size).toBe(500);
    d.prune(T0 + SURGE_WINDOW_MS + 1);
    expect(d.size).toBe(0);
  });

  it('reports the most-edited article, needing 2+ people', () => {
    const d = new SurgeDetector();
    burst(d, 'en|Solo', 9, 1);
    burst(d, 'en|Busy', 5, 2);
    burst(d, 'de|Less', 3, 3);
    expect(d.top()).toMatchObject({ key: 'en|Busy', edits: 5, editors: 2 });
  });
});
