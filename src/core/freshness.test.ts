import { describe, expect, it } from 'vitest';
import { Freshness } from './freshness';

describe('Freshness', () => {
  it('is connecting until the first success, then live', () => {
    const f = new Freshness(60_000, 0);
    expect(f.state(10_000)).toBe('connecting');
    f.markSuccess(20_000);
    expect(f.state(30_000)).toBe('live');
  });

  it('is delayed after more than 3× the poll interval without success', () => {
    const f = new Freshness(60_000, 0);
    f.markSuccess(0);
    expect(f.state(180_000)).toBe('live');
    expect(f.state(180_001)).toBe('delayed');
    f.markError(200_000);
    expect(f.state(200_000)).toBe('delayed');
    f.markSuccess(210_000);
    expect(f.state(210_000)).toBe('live');
  });

  it('is delayed if the source never answers', () => {
    expect(new Freshness(60_000, 0).state(181_000)).toBe('delayed');
  });

  it('reports reconnecting honestly, and delayed once it takes too long', () => {
    const f = new Freshness(5_000, 0);
    f.markSuccess(1_000);
    f.markReconnecting();
    expect(f.state(3_000)).toBe('reconnecting');
    expect(f.state(17_000)).toBe('delayed');
    f.markSuccess(18_000);
    expect(f.state(18_000)).toBe('live');
  });
});
