import { describe, expect, it } from 'vitest';
import { fadeForAge, popScale, ringAt, xForAge, yToPx } from './river';

const H = 3_600_000;

describe('river geometry', () => {
  it('places new events at the NOW line and old ones at the left edge', () => {
    expect(xForAge(0, H, 1000)).toBe(1000);
    expect(xForAge(H / 2, H, 1000)).toBe(500);
    expect(xForAge(H, H, 1000)).toBe(0);
    expect(xForAge(-500, H, 1000)).toBe(1000); // future timestamps clamp to NOW
  });

  it('fades dots over the last 10% of the window', () => {
    expect(fadeForAge(0, H)).toBe(1);
    expect(fadeForAge(H * 0.9, H)).toBe(1);
    expect(fadeForAge(H * 0.95, H)).toBeCloseTo(0.5);
    expect(fadeForAge(H, H)).toBe(0);
  });

  it('maps y into a padded band', () => {
    expect(yToPx(0, 300)).toBe(30);
    expect(yToPx(1, 300)).toBe(270);
    expect(yToPx(2, 300)).toBe(270);
  });
});

describe('river motion', () => {
  it('pops in 0 → 1.35 → 1 over 700 ms', () => {
    expect(popScale(0)).toBe(0);
    expect(popScale(490)).toBeCloseTo(1.35);
    expect(popScale(700)).toBe(1);
    expect(popScale(Infinity)).toBe(1);
  });

  it('rings expand 0.8× → 5× and fade over 2 s', () => {
    expect(ringAt(0)).toEqual({ scale: 0.8, alpha: 0.9 });
    expect(ringAt(1999)!.scale).toBeCloseTo(5, 1);
    expect(ringAt(2000)).toBeNull();
    expect(ringAt(Infinity)).toBeNull();
  });
});
