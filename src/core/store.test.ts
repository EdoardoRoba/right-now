import { describe, expect, it, vi } from 'vitest';
import { EventStore } from './store';
import type { LiveEvent } from './types';

const MIN = 60_000;
const NOW = 1_000_000_000;

function ev(id: string, ageMs: number, extra: Partial<LiveEvent> = {}): LiveEvent {
  return {
    id,
    channel: 'earthquakes',
    time: NOW - ageMs,
    receivedAt: NOW,
    title: id,
    value: 1,
    y: 0.5,
    size: 6,
    color: '#7FA8FF',
    important: false,
    meta: {},
    ...extra,
  };
}

describe('EventStore', () => {
  it('dedupes by id', () => {
    const s = new EventStore({ windowMs: 60 * MIN });
    s.upsert([ev('a', 1000), ev('b', 2000)], NOW);
    const change = s.upsert([ev('a', 1000), ev('b', 2000)], NOW);
    expect(s.size).toBe(2);
    expect(change.added).toHaveLength(0);
    expect(change.updated).toHaveLength(0);
  });

  it('updates revised events in place, keeping the first receivedAt', () => {
    const s = new EventStore({ windowMs: 60 * MIN });
    s.upsert([ev('a', 1000, { value: 2.4 })], NOW);
    const original = s.get('a')!;
    const change = s.upsert(
      [ev('a', 1000, { value: 2.6, important: true, receivedAt: NOW + 60_000 })],
      NOW + 60_000,
    );
    expect(change.updated).toEqual([original]);
    expect(s.get('a')).toBe(original); // same object
    expect(original.value).toBe(2.6);
    expect(original.important).toBe(true);
    expect(original.receivedAt).toBe(NOW);
  });

  it('detects meta-only revisions', () => {
    const s = new EventStore({ windowMs: 60 * MIN });
    s.upsert([ev('a', 0, { meta: { depthKm: 10 } })], NOW);
    expect(s.upsert([ev('a', 0, { meta: { depthKm: 12 } })], NOW).updated).toHaveLength(1);
  });

  it('keeps events sorted by time and exposes the window', () => {
    const s = new EventStore({ windowMs: 10 * MIN });
    s.upsert([ev('new', 1 * MIN), ev('old', 9 * MIN), ev('mid', 5 * MIN)], NOW);
    expect(s.all().map((e) => e.id)).toEqual(['old', 'mid', 'new']);
    expect(s.inWindow(NOW + 2 * MIN).map((e) => e.id)).toEqual(['mid', 'new']);
  });

  it('prunes unimportant events after the window and important ones after the retention', () => {
    const s = new EventStore({ windowMs: 60 * MIN, retainImportantMs: 24 * 60 * MIN, fadeMs: 0 });
    s.upsert(
      [
        ev('fresh', 10 * MIN),
        ev('stale', 61 * MIN),
        ev('notable', 5 * 60 * MIN, { important: true }),
        ev('ancient', 25 * 60 * MIN, { important: true }),
      ],
      NOW,
    );
    expect(
      s
        .all()
        .map((e) => e.id)
        .sort(),
    ).toEqual(['fresh', 'notable']);
    expect(s.important().map((e) => e.id)).toEqual(['notable']);
  });

  it('keeps a few seconds for fade-out', () => {
    const s = new EventStore({ windowMs: 60 * MIN, fadeMs: 5_000 });
    s.upsert([ev('a', 60 * MIN + 2_000)], NOW);
    expect(s.size).toBe(1);
    s.prune(NOW + 4_000);
    expect(s.size).toBe(0);
  });

  it('caps the size, dropping the oldest unimportant events first', () => {
    const s = new EventStore({ windowMs: 60 * MIN, maxEvents: 3 });
    s.upsert(
      [
        ev('imp-old', 50 * MIN, { important: true }),
        ev('u1', 40 * MIN),
        ev('u2', 30 * MIN),
        ev('u3', 20 * MIN),
        ev('u4', 10 * MIN),
      ],
      NOW,
    );
    expect(s.all().map((e) => e.id)).toEqual(['imp-old', 'u3', 'u4']);
  });

  it('notifies subscribers and flags the first fill', () => {
    const s = new EventStore({ windowMs: 60 * MIN });
    const fn = vi.fn();
    s.subscribe(fn);
    s.upsert([ev('a', 0)], NOW);
    s.upsert([ev('b', 0)], NOW);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[0]![0].initial).toBe(true);
    expect(fn.mock.calls[1]![0].initial).toBe(false);
  });

  it('notifies on pruning', () => {
    const s = new EventStore({ windowMs: MIN, fadeMs: 0 });
    s.upsert([ev('a', 0)], NOW);
    const fn = vi.fn();
    s.subscribe(fn);
    s.prune(NOW + 2 * MIN);
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ removed: [expect.objectContaining({ id: 'a' })] }),
    );
  });
});
