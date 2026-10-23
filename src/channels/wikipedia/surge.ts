/**
 * Surge detection: an article "surges" when many different people edit it
 * within a short window — usually because something just happened in the world.
 *
 * Privacy: editors are only ever seen here as opaque numbers (a salted
 * in-memory hash computed by the source). Usernames and IPs never reach this
 * module, are never stored, and never leave the page.
 */

/** Sliding window per article. */
export const SURGE_WINDOW_MS = 10 * 60_000;
/** Minimum edits to the same article inside the window. */
export const SURGE_MIN_EDITS = 15;
/** Minimum distinct (non-bot) editors inside the window. */
export const SURGE_MIN_EDITORS = 5;

export interface EditSample {
  /** `${wiki}|${title}` — one article. */
  key: string;
  time: number;
  editor: number;
}

export interface SurgeUpdate {
  /** Stable for one surge episode: `${key}@${startedAt}`. */
  id: string;
  key: string;
  startedAt: number;
  edits: number;
  editors: number;
  /** True the first time this episode crosses the thresholds. */
  isNew: boolean;
}

interface Article {
  times: number[];
  editors: number[];
  /** editor → number of their edits still inside the window */
  counts: Map<number, number>;
  head: number;
  surgeStart?: number;
}

export interface SurgeOptions {
  windowMs?: number;
  minEdits?: number;
  minEditors?: number;
}

export class SurgeDetector {
  readonly windowMs: number;
  readonly minEdits: number;
  readonly minEditors: number;
  private articles = new Map<string, Article>();

  constructor(opts: SurgeOptions = {}) {
    this.windowMs = opts.windowMs ?? SURGE_WINDOW_MS;
    this.minEdits = opts.minEdits ?? SURGE_MIN_EDITS;
    this.minEditors = opts.minEditors ?? SURGE_MIN_EDITORS;
  }

  /** Feeds one (non-bot) edit. Returns the surge state if the article is surging. */
  add(edit: EditSample): SurgeUpdate | null {
    let a = this.articles.get(edit.key);
    if (!a) {
      a = { times: [], editors: [], counts: new Map(), head: 0 };
      this.articles.set(edit.key, a);
    }
    a.times.push(edit.time);
    a.editors.push(edit.editor);
    a.counts.set(edit.editor, (a.counts.get(edit.editor) ?? 0) + 1);
    this.expire(a, edit.time);

    const edits = a.times.length - a.head;
    const editors = a.counts.size;
    if (edits >= this.minEdits && editors >= this.minEditors) {
      const isNew = a.surgeStart === undefined;
      if (isNew) a.surgeStart = edit.time;
      const startedAt = a.surgeStart!;
      return { id: `${edit.key}@${startedAt}`, key: edit.key, startedAt, edits, editors, isNew };
    }
    // Back under the thresholds: the episode is over; a later crossing is a new surge.
    a.surgeStart = undefined;
    return null;
  }

  /** Current counts for one article (e.g. to refresh a surge). */
  stats(key: string): { edits: number; editors: number; last: number } {
    const a = this.articles.get(key);
    if (!a || a.times.length === a.head) return { edits: 0, editors: 0, last: 0 };
    return {
      edits: a.times.length - a.head,
      editors: a.counts.size,
      last: a.times[a.times.length - 1]!,
    };
  }

  /** Drops edits that left the window and forgets idle articles. Call every few seconds. */
  prune(now: number): void {
    for (const [key, a] of this.articles) {
      this.expire(a, now);
      if (a.times.length - a.head < this.minEdits || a.counts.size < this.minEditors) {
        a.surgeStart = undefined;
      }
      if (a.times.length === a.head) this.articles.delete(key);
      else if (a.head > 64 && a.head * 2 > a.times.length) this.compact(a);
    }
  }

  /**
   * The most-edited article in the window (needs ≥ minEdits edits by
   * ≥ minEditors people), used while no surge is in progress.
   */
  top(
    minEdits = 3,
    minEditors = 2,
  ): { key: string; edits: number; editors: number; last: number } | undefined {
    let best: { key: string; edits: number; editors: number; last: number } | undefined;
    for (const [key, a] of this.articles) {
      const edits = a.times.length - a.head;
      if (edits < minEdits || a.counts.size < minEditors) continue;
      if (!best || edits > best.edits || (edits === best.edits && a.counts.size > best.editors)) {
        best = { key, edits, editors: a.counts.size, last: a.times[a.times.length - 1]! };
      }
    }
    return best;
  }

  /** Number of articles currently tracked (for tests / memory checks). */
  get size(): number {
    return this.articles.size;
  }

  private expire(a: Article, now: number): void {
    const cutoff = now - this.windowMs;
    while (a.head < a.times.length && a.times[a.head]! < cutoff) {
      const ed = a.editors[a.head]!;
      const c = (a.counts.get(ed) ?? 1) - 1;
      if (c <= 0) a.counts.delete(ed);
      else a.counts.set(ed, c);
      a.head++;
    }
  }

  private compact(a: Article): void {
    a.times = a.times.slice(a.head);
    a.editors = a.editors.slice(a.head);
    a.head = 0;
  }
}
