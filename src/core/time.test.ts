import { describe, expect, it } from 'vitest';
import { agoRefreshMs, formatAgo, formatAgoShort, formatUtcClock, formatUtcDateTime } from './time';

describe('formatAgo', () => {
  it('shows tenths of a second under a minute', () => {
    expect(formatAgo(0)).toBe('0.0 s ago');
    expect(formatAgo(4_230)).toBe('4.2 s ago');
    expect(formatAgo(59_990)).toBe('59.9 s ago');
  });
  it('switches to minutes, hours and days', () => {
    expect(formatAgo(60_000)).toBe('1 min ago');
    expect(formatAgo(3 * 60_000 + 59_000)).toBe('3 min ago');
    expect(formatAgo(2 * 3_600_000 + 5)).toBe('2 h ago');
    expect(formatAgo(86_400_000)).toBe('1 day ago');
    expect(formatAgo(3 * 86_400_000)).toBe('3 days ago');
  });
  it('never shows negative ages (clock skew)', () => {
    expect(formatAgo(-5_000)).toBe('0.0 s ago');
  });
  it('has a short form without tenths', () => {
    expect(formatAgoShort(12_900)).toBe('12 s ago');
    expect(formatAgoShort(125_000)).toBe('2 min ago');
  });
});

describe('agoRefreshMs', () => {
  it('ticks every 100 ms under a minute, then every second', () => {
    expect(agoRefreshMs(5_000)).toBe(100);
    expect(agoRefreshMs(60_000)).toBe(1000);
  });
});

describe('UTC formatting', () => {
  const t = Date.UTC(2026, 9, 23, 4, 5, 9);
  it('formats the header clock', () => expect(formatUtcClock(t)).toBe('04:05:09'));
  it('formats date-times', () => expect(formatUtcDateTime(t)).toBe('2026-10-23 04:05 UTC'));
});
