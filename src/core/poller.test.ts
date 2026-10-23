import { describe, expect, it } from 'vitest';
import { nextDelay } from './poller';

describe('nextDelay', () => {
  it('doubles per consecutive failure and caps at the maximum', () => {
    const base = 60_000;
    const max = 600_000;
    expect(nextDelay(0, base, max)).toBe(60_000);
    expect(nextDelay(1, base, max)).toBe(120_000);
    expect(nextDelay(2, base, max)).toBe(240_000);
    expect(nextDelay(3, base, max)).toBe(480_000);
    expect(nextDelay(4, base, max)).toBe(600_000);
    expect(nextDelay(20, base, max)).toBe(600_000);
  });
});
