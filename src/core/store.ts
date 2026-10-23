/**
 * Tiny event store: dedupe by id, in-place updates, window pruning and
 * subscriptions. Kept framework-free so the river can read it every frame.
 */
import type { LiveEvent } from './types';

export interface StoreChange {
  added: LiveEvent[];
  updated: LiveEvent[];
  removed: LiveEvent[];
  /** True for the first fill, so views can skip arrival animations. */
  initial: boolean;
}

export interface StoreOptions {
  /** River window; unimportant events older than this (+ fade) are pruned. */
  windowMs: number;
  /** How long important events are kept for the Pulse and side list. */
  retainImportantMs?: number;
  /** Hard cap; the oldest unimportant events are dropped first. */
  maxEvents?: number;
  /** Extra time kept after the window so dots can fade out. */
  fadeMs?: number;
}

export class EventStore {
  readonly windowMs: number;
  readonly retainImportantMs: number;
  readonly maxEvents: number;
  readonly fadeMs: number;

  private byId = new Map<string, LiveEvent>();
  /** Sorted by time ascending; rebuilt lazily after changes. */
  private sorted: LiveEvent[] | null = null;
  private listeners = new Set<(change: StoreChange) => void>();
  private filled = false;

  constructor(opts: StoreOptions) {
    this.windowMs = opts.windowMs;
    this.retainImportantMs = Math.max(opts.retainImportantMs ?? opts.windowMs, opts.windowMs);
    this.maxEvents = opts.maxEvents ?? 1500;
    this.fadeMs = opts.fadeMs ?? 5_000;
  }

  get size(): number {
    return this.byId.size;
  }

  get(id: string): LiveEvent | undefined {
    return this.byId.get(id);
  }

  /**
   * Adds new events and updates known ones in place (same object, so anything
   * holding a reference sees the revision). `receivedAt` of the first sighting wins.
   */
  upsert(events: LiveEvent[], now: number): StoreChange {
    const added: LiveEvent[] = [];
    const updated: LiveEvent[] = [];
    for (const ev of events) {
      const existing = this.byId.get(ev.id);
      if (!existing) {
        this.byId.set(ev.id, ev);
        added.push(ev);
      } else if (changed(existing, ev)) {
        Object.assign(existing, ev, { receivedAt: existing.receivedAt });
        updated.push(existing);
      }
    }
    if (added.length || updated.length) this.sorted = null;
    const removed = this.prune(now, false);
    const change = { added, updated, removed, initial: !this.filled };
    this.filled = true;
    if (added.length || updated.length || removed.length) this.emit(change);
    return change;
  }

  /** Drops events that left the window, then enforces the cap. */
  prune(now: number, notify = true): LiveEvent[] {
    const removed: LiveEvent[] = [];
    const riverCutoff = now - this.windowMs - this.fadeMs;
    const importantCutoff = now - this.retainImportantMs - this.fadeMs;
    for (const ev of this.byId.values()) {
      const cutoff = ev.important ? importantCutoff : riverCutoff;
      if (ev.time < cutoff) removed.push(ev);
    }
    for (const ev of removed) this.byId.delete(ev.id);

    if (this.byId.size > this.maxEvents) {
      // Oldest unimportant first, then oldest important if still over the cap.
      const list = this.all();
      const victims = [...list.filter((e) => !e.important), ...list.filter((e) => e.important)];
      for (const ev of victims) {
        if (this.byId.size <= this.maxEvents) break;
        this.byId.delete(ev.id);
        removed.push(ev);
      }
    }

    if (removed.length) {
      this.sorted = null;
      if (notify) this.emit({ added: [], updated: [], removed, initial: false });
    }
    return removed;
  }

  /** All events, time ascending. Do not mutate the returned array. */
  all(): LiveEvent[] {
    if (!this.sorted) this.sorted = [...this.byId.values()].sort((a, b) => a.time - b.time);
    return this.sorted;
  }

  /** Events inside the river window (time ascending). */
  inWindow(now: number): LiveEvent[] {
    const from = now - this.windowMs;
    return this.all().filter((e) => e.time >= from);
  }

  /** Important events, newest first. */
  important(): LiveEvent[] {
    return this.all()
      .filter((e) => e.important)
      .reverse();
  }

  subscribe(fn: (change: StoreChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  clear(): void {
    this.byId.clear();
    this.sorted = null;
    this.filled = false;
  }

  private emit(change: StoreChange): void {
    for (const fn of this.listeners) fn(change);
  }
}

function changed(a: LiveEvent, b: LiveEvent): boolean {
  if (
    a.time !== b.time ||
    a.value !== b.value ||
    a.title !== b.title ||
    a.y !== b.y ||
    a.important !== b.important ||
    a.url !== b.url
  ) {
    return true;
  }
  const ka = Object.keys(a.meta);
  if (ka.length !== Object.keys(b.meta).length) return true;
  return ka.some((k) => a.meta[k] !== b.meta[k]);
}
