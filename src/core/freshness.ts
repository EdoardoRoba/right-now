/**
 * Tracks the last successful update of a source. Drives the "Updated 12 s ago"
 * label and the "Data delayed" badge (no success for > 3× the poll interval).
 */

export type FreshnessState = 'connecting' | 'live' | 'delayed';

export class Freshness {
  lastSuccess: number | null = null;
  lastError: number | null = null;
  private listeners = new Set<() => void>();

  constructor(
    readonly intervalMs: number,
    private readonly startedAt: number,
  ) {}

  markSuccess(now: number): void {
    this.lastSuccess = now;
    this.emit();
  }

  markError(now: number): void {
    this.lastError = now;
    this.emit();
  }

  state(now: number): FreshnessState {
    const limit = this.intervalMs * 3;
    if (this.lastSuccess === null) return now - this.startedAt > limit ? 'delayed' : 'connecting';
    return now - this.lastSuccess > limit ? 'delayed' : 'live';
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
