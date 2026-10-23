/**
 * Time helpers. Everything takes `now` explicitly (or a Clock) so tests can
 * freeze time instead of mocking Date.
 */

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "4.2 s ago", "3 min ago", "2 h ago", "3 days ago". */
export function formatAgo(ms: number): string {
  const d = Math.max(0, ms);
  if (d < MIN) return `${(Math.floor(d / 100) / 10).toFixed(1)} s ago`;
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`;
  const days = Math.floor(d / DAY);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** Shorter form for tight spaces: "42 s", "3 min", "2 h". */
export function formatAgoShort(ms: number): string {
  const d = Math.max(0, ms);
  if (d < MIN) return `${Math.floor(d / SEC)} s ago`;
  return formatAgo(d);
}

/** How often an "ago" label needs refreshing: 100 ms under a minute, then 1 s. */
export function agoRefreshMs(ms: number): number {
  return ms < MIN ? 100 : 1000;
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** "14:03:22" in UTC. */
export function formatUtcClock(t: number): string {
  const d = new Date(t);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}

/** "2026-10-23 14:03 UTC". */
export function formatUtcDateTime(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`;
}
