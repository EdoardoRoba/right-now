/**
 * Wikimedia EventStreams (recentchange) → LiveEvent.
 * Spec: https://stream.wikimedia.org/?doc
 *
 * Privacy: usernames and IPs are never stored, shown or sent anywhere. The
 * only thing derived from them is a salted, in-memory 32-bit hash used to
 * count distinct editors for surge detection.
 */
import { palette } from '../../core/palette';
import type { ChannelContext, LiveEvent } from '../../core/types';
import { SurgeDetector, type SurgeUpdate } from './surge';

export const STREAM_URL = 'https://stream.wikimedia.org/v2/stream/recentchange';
/** Most edit dots drawn per second; stats still count every edit. */
export const MAX_DRAWN_PER_SEC = 30;
/** Edits whose size change is at least this big get a label in the river. */
export const BIG_EDIT_BYTES = 4000;
/** "Most edited" fallback hero, shown while no surge is in progress. */
export const BUSIEST_MIN_EDITS = 2;
export const BUSIEST_MIN_EDITORS = 2;
/** How far back to resume after a disconnect (bounded so a replay can't flood the page). */
export const MAX_RESUME_MS = 30_000;
/**
 * Events older than this are not "right now": they're never drawn or counted.
 * (A numeric `?since=` once made Wikimedia replay 9 days of history.)
 */
export const STALE_MS = 2 * 60_000;
/** After this many stale messages in a row, drop the connection and start fresh. */
export const STALE_RESET_AFTER = 200;

/** `?since=` must be an ISO date: Wikimedia mis-reads epoch milliseconds (verified live). */
export const resumeUrl = (since: number) =>
  `${STREAM_URL}?since=${encodeURIComponent(new Date(since).toISOString())}`;
const LOG_CAP = 4.2; // log10 of ~16 kB: the river's full height

// ---------------------------------------------------------------------------
// Parsing & filtering
// ---------------------------------------------------------------------------

export interface RawChange {
  meta?: { id?: string; dt?: string; domain?: string };
  id?: string;
  dt?: string;
  type?: string;
  namespace?: number;
  title?: string;
  server_name?: string;
  wiki?: string;
  bot?: boolean;
  user?: string;
  /** Recorded fixtures carry a pre-hashed editor instead of `user`. */
  editor?: string;
  timestamp?: number;
  length?: { old?: number | null; new?: number | null };
}

export interface Edit {
  id: string;
  time: number;
  title: string;
  serverName: string;
  bot: boolean;
  bytes: number;
  editorKey: string;
}

/** Wikipedia article edits only (`type: edit`, namespace 0, *.wikipedia.org). */
export function parseChange(raw: RawChange): Edit | null {
  if (raw.type !== 'edit' || raw.namespace !== 0) return null;
  const server = raw.server_name;
  if (!server || !server.endsWith('.wikipedia.org') || !raw.title) return null;
  const id = raw.meta?.id ?? raw.id;
  const dt = raw.meta?.dt ?? raw.dt;
  const time = dt ? Date.parse(dt) : (raw.timestamp ?? NaN) * 1000;
  if (!id || !Number.isFinite(time)) return null;
  const bytes = (raw.length?.new ?? 0) - (raw.length?.old ?? 0);
  return {
    id,
    time,
    title: raw.title,
    serverName: server,
    bot: raw.bot === true,
    bytes,
    editorKey: raw.user ?? raw.editor ?? '',
  };
}

// ---------------------------------------------------------------------------
// Mapping (mockup F)
// ---------------------------------------------------------------------------

export function articleUrl(serverName: string, title: string): string {
  return `https://${serverName}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/** "it.wikipedia" from "it.wikipedia.org". */
export const wikiLabel = (serverName: string) => serverName.replace(/\.org$/, '');

/** "+1,234" / "−567" (true minus sign, like the mockup). */
export function formatBytes(bytes: number): string {
  const n = Math.abs(bytes).toLocaleString('en-US');
  return bytes >= 0 ? `+${n}` : `−${n}`;
}

const logBytes = (bytes: number) => Math.min(Math.log10(Math.abs(bytes) + 1), LOG_CAP);

/** Added text above the centre line, removed text below, on a log scale. */
export function bytesToY(bytes: number): number {
  const sign = bytes >= 0 ? 1 : -1;
  return 0.5 - (sign * logBytes(bytes) * 0.5) / LOG_CAP;
}

export function bytesColor(bytes: number, bot: boolean): string {
  if (bot) return palette.dim;
  return bytes >= 0 ? palette.small : palette.strong;
}

export function editToEvent(e: Edit, receivedAt: number): LiveEvent {
  const big = Math.abs(e.bytes) >= BIG_EDIT_BYTES;
  return {
    id: e.id,
    channel: 'wikipedia',
    time: e.time,
    receivedAt,
    title: e.title,
    value: e.bytes,
    y: bytesToY(e.bytes),
    size: Math.round(4 + logBytes(e.bytes) * 2.6),
    color: bytesColor(e.bytes, e.bot),
    important: false,
    showLabel: big && !e.bot,
    label: e.title,
    labelValue: formatBytes(e.bytes),
    url: articleUrl(e.serverName, e.title),
    meta: { bot: e.bot, wiki: wikiLabel(e.serverName) },
  };
}

export function surgeToEvent(s: SurgeUpdate, lead: Edit, receivedAt: number): LiveEvent {
  return {
    id: `surge:${s.id}`,
    channel: 'wikipedia',
    time: s.startedAt,
    receivedAt,
    title: lead.title,
    value: s.edits,
    y: bytesToY(lead.bytes),
    size: 20,
    color: palette.mid,
    important: true,
    label: lead.title,
    labelValue: `${s.edits} edits`,
    url: articleUrl(lead.serverName, lead.title),
    meta: { kind: 'surge', editors: s.editors, wiki: wikiLabel(lead.serverName) },
  };
}

// ---------------------------------------------------------------------------
// Runtime: everything between raw events and the store (also used by tests & demo)
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit over a per-session random salt + the name. Never leaves memory. */
function makeEditorHasher(): (name: string) => number {
  const salt = Array.from({ length: 4 }, () => Math.floor(Math.random() * 2 ** 32));
  return (name) => {
    let h = 0x811c9dc5;
    for (const s of salt) h = Math.imul(h ^ s, 0x01000193);
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
    return h >>> 0;
  };
}

export class WikipediaRuntime {
  readonly detector: SurgeDetector;
  private hashEditor = makeEditorHasher();
  private surges = new Map<string, LiveEvent>();
  /** receive times of every edit in the last 5 s (edits/s stat) */
  private recent: number[] = [];
  /** [time, bytes] of additions in the last 60 s (text-added stat) */
  private added: [number, number][] = [];
  private addedSum = 0;
  private busy: LiveEvent | undefined;
  private bucket = MAX_DRAWN_PER_SEC;
  private bucketAt = 0;

  constructor(detector = new SurgeDetector()) {
    this.detector = detector;
  }

  /** Processes one edit; returns the LiveEvents to add/update (possibly none). */
  ingest(e: Edit, now: number): LiveEvent[] {
    this.count(e, now);
    const out: LiveEvent[] = [];
    let drewLead = false;
    if (!e.bot) {
      const key = `${e.serverName}|${e.title}`;
      const s = this.detector.add({ key, time: e.time, editor: this.hashEditor(e.editorKey) });
      if (s) {
        const prev = this.surges.get(s.id);
        const ev = prev
          ? {
              ...prev,
              value: s.edits,
              labelValue: `${s.edits} edits`,
              meta: { ...prev.meta, editors: s.editors },
            }
          : surgeToEvent(s, e, now);
        this.surges.set(s.id, ev);
        out.push(ev);
        drewLead = s.isNew; // the surge dot stands in for the edit that triggered it
      }
    }
    if (!drewLead && this.take(now)) out.push(editToEvent(e, now));
    return out;
  }

  /**
   * The most-edited article of the last 10 minutes (shown while no surge is
   * in progress). A challenger needs 2 more edits than the current one to
   * take over, so the Pulse doesn't flicker between near-ties.
   */
  busiest(): LiveEvent | undefined {
    // ≥ 2 edits by ≥ 2 people: shows up within ~1 min of opening the page (measured).
    const top = this.detector.top(BUSIEST_MIN_EDITS, BUSIEST_MIN_EDITORS);
    if (!top) return (this.busy = undefined);
    let key = top.key;
    let stats: { edits: number; editors: number; last: number } = top;
    const currentKey = this.busy ? String(this.busy.meta.key) : undefined;
    if (currentKey && currentKey !== top.key) {
      const cur = this.detector.stats(currentKey);
      if (cur.edits >= BUSIEST_MIN_EDITS && top.edits < cur.edits + 2) {
        key = currentKey;
        stats = cur;
      }
    }
    const [serverName = '', title = ''] = key.split('|');
    this.busy = {
      id: `busy:${key}`,
      channel: 'wikipedia',
      time: stats.last,
      receivedAt: stats.last,
      title,
      value: stats.edits,
      y: 0.5,
      size: 12,
      color: palette.small,
      important: false,
      url: articleUrl(serverName, title),
      meta: { kind: 'busiest', key, editors: stats.editors, wiki: wikiLabel(serverName) },
    };
    return this.busy;
  }

  /** Edits per second, 5 s moving average, over ALL edits (sampled or not). */
  editsPerSecond(now: number): number {
    this.trim(now);
    return this.recent.length / 5;
  }

  /** Bytes of text added in the last 60 s, over ALL edits. */
  bytesAdded(now: number): number {
    this.trim(now);
    return this.addedSum;
  }

  prune(now: number, keepSurgesMs: number): void {
    this.detector.prune(now);
    for (const [id, ev] of this.surges) if (now - ev.time > keepSurgesMs) this.surges.delete(id);
    this.trim(now);
  }

  private count(e: Edit, now: number): void {
    this.recent.push(now);
    if (e.bytes > 0) {
      this.added.push([now, e.bytes]);
      this.addedSum += e.bytes;
    }
  }

  private trim(now: number): void {
    while (this.recent.length && this.recent[0]! < now - 5_000) this.recent.shift();
    while (this.added.length && this.added[0]![0] < now - 60_000)
      this.addedSum -= this.added.shift()![1];
  }

  /** Token bucket: at most MAX_DRAWN_PER_SEC dots per second. */
  private take(now: number): boolean {
    this.bucket = Math.min(
      MAX_DRAWN_PER_SEC,
      this.bucket + ((now - this.bucketAt) / 1000) * MAX_DRAWN_PER_SEC,
    );
    this.bucketAt = now;
    if (this.bucket < 1) return false;
    this.bucket -= 1;
    return true;
  }
}

/** The runtime of the mounted channel view, read by the channel's stats(). */
export let current: WikipediaRuntime | null = null;
export function setCurrent(rt: WikipediaRuntime | null): void {
  current = rt;
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

export interface StreamOptions {
  EventSourceImpl?: typeof EventSource;
  now?: () => number;
  retainSurgesMs: number;
}

/**
 * Connects with EventSource. The browser reconnects by itself (sending
 * Last-Event-ID); if the connection is closed for good we reopen it with an
 * ISO `?since=` (bounded to the last 30 s) and exponential backoff. Stale
 * events (a replay of old history) are ignored and trigger a fresh
 * connection. The stream is closed while the tab is hidden, to save the
 * visitor's bandwidth.
 */
export function startWikipedia(ctx: ChannelContext, opts: StreamOptions): () => void {
  const ES = opts.EventSourceImpl ?? EventSource;
  const now = opts.now ?? Date.now;
  const rt = new WikipediaRuntime();
  setCurrent(rt);

  let es: EventSource | null = null;
  let lastDt: number | null = null;
  let retries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let batch: LiveEvent[] = [];
  let lastMark = 0;
  let staleRun = 0;

  const onMessage = (msg: MessageEvent<string>) => {
    let raw: RawChange;
    try {
      raw = JSON.parse(msg.data);
    } catch {
      return;
    }
    const t = now();
    const dt = Date.parse(raw.meta?.dt ?? raw.dt ?? '');
    if (Number.isFinite(dt) && dt < t - STALE_MS) {
      // Old history, not "right now": never draw or count it.
      ctx.freshness.markReconnecting();
      if (++staleRun >= STALE_RESET_AFTER) {
        staleRun = 0;
        lastDt = null;
        disconnect();
        connect();
      }
      return;
    }
    staleRun = 0;
    if (Number.isFinite(dt)) lastDt = Math.max(lastDt ?? 0, dt);
    const edit = parseChange(raw);
    if (edit) batch.push(...rt.ingest(edit, t));
    retries = 0;
    if (t - lastMark > 1000) {
      lastMark = t;
      ctx.freshness.markSuccess(t);
    }
  };

  const connect = () => {
    if (stopped) return;
    const since = lastDt === null ? null : Math.max(lastDt, now() - MAX_RESUME_MS);
    es = new ES(since === null ? STREAM_URL : resumeUrl(since));
    es.onmessage = onMessage;
    es.onerror = () => {
      ctx.freshness.markReconnecting();
      if (es && es.readyState === 2 /* CLOSED */) {
        es.close();
        es = null;
        retries += 1;
        retryTimer = setTimeout(connect, Math.min(1000 * 2 ** retries, 60_000));
      }
    };
  };

  const disconnect = () => {
    clearTimeout(retryTimer);
    es?.close();
    es = null;
  };

  const onVisibility = () => {
    if (document.hidden) disconnect();
    else if (!es) connect();
  };

  // Flush batched events to the store 4× a second (one re-render per batch).
  const flush = setInterval(() => {
    if (!batch.length) return;
    const events = batch;
    batch = [];
    ctx.store.upsert(events, now());
  }, 250);
  const prune = setInterval(() => rt.prune(now(), opts.retainSurgesMs), 5_000);

  document.addEventListener('visibilitychange', onVisibility);
  connect();

  return () => {
    stopped = true;
    disconnect();
    clearInterval(flush);
    clearInterval(prune);
    document.removeEventListener('visibilitychange', onVisibility);
    setCurrent(null);
  };
}
